import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { artistProfiles } from "@/lib/db/schema/artist_profiles";
import { artistProfileFiles } from "@/lib/db/schema/artist_profile_files";
import { artistProfileChangeRequests } from "@/lib/db/schema/artist_profile_change_requests";
import { auditLog } from "@/lib/db/schema/audit_log";
import {
  ARTIST_DETAIL_KEYS,
  ARTIST_DOCUMENT_KINDS,
  ARTIST_FIELD_LABELS,
  changedFields,
  checkDetails,
  maskNumber,
  normaliseDetails,
  PENDING_STATUS,
  type ArtistDetailsInput,
  type ArtistDocumentKind,
} from "./details-rules";
import {
  detailsReminderText,
  emailArtistToVerifyDetails,
  messageArtistOnDiscord,
  notifyArtistOfDetailsDecision,
  notifyTeamOfArtistDetails,
} from "./details-notifications";

// Where these changes are logged in audit_log. Bank numbers are never put in the payload.
const DETAILS_ENTITY = "artist_profile";
const ARTIST_ROLE = "artist";

/** The request can't be carried out: missing or malformed details, or a change while one is pending. */
export class ArtistDetailsError extends Error {}

/** No such artist, file or change request. */
export class ArtistDetailsNotFoundError extends Error {}

type ProfileRow = typeof artistProfiles.$inferSelect;

function detailsOf(row: ProfileRow | null): ArtistDetailsInput {
  const empty = Object.fromEntries(ARTIST_DETAIL_KEYS.map((k) => [k, null])) as unknown as ArtistDetailsInput;
  if (!row) return empty;
  return Object.fromEntries(ARTIST_DETAIL_KEYS.map((k) => [k, (row[k] as string | null) ?? null])) as unknown as ArtistDetailsInput;
}

async function loadArtist(personnelId: string) {
  const [artist] = await db
    .select({ id: personnel.id, name: personnel.name, email: personnel.email, discordUserId: personnel.discordUserId, discordChannelId: personnel.discordChannelId })
    .from(personnel)
    .where(eq(personnel.id, personnelId))
    .limit(1);
  if (!artist) throw new ArtistDetailsNotFoundError("No such artist");
  return artist;
}

async function loadProfile(personnelId: string): Promise<ProfileRow | null> {
  const [row] = await db.select().from(artistProfiles).where(eq(artistProfiles.personnelId, personnelId)).limit(1);
  return row ?? null;
}

export interface ArtistFileView {
  id: string;
  kind: string;
  fileName: string;
  driveUrl: string | null;
  sizeBytes: number | null;
  /** Whether the app keeps its own copy of the file, besides Drive. */
  hasCopy: boolean;
  createdAt: Date;
}

const fileColumns = {
  id: artistProfileFiles.id,
  kind: artistProfileFiles.kind,
  fileName: artistProfileFiles.fileName,
  driveUrl: artistProfileFiles.driveUrl,
  sizeBytes: artistProfileFiles.sizeBytes,
  hasCopy: sql<boolean>`${artistProfileFiles.bytes} is not null`,
  createdAt: artistProfileFiles.createdAt,
};

export interface ArtistDetailsView {
  details: ArtistDetailsInput;
  submittedAt: Date | null;
  importedFromFormAt: Date | null;
  files: ArtistFileView[];
  pendingChange: { id: string; fields: string[]; reason: string; createdAt: Date } | null;
}

async function viewFor(personnelId: string): Promise<ArtistDetailsView> {
  const [profile, files, [pending]] = await Promise.all([
    loadProfile(personnelId),
    db.select(fileColumns).from(artistProfileFiles).where(eq(artistProfileFiles.personnelId, personnelId)).orderBy(desc(artistProfileFiles.createdAt)),
    db
      .select()
      .from(artistProfileChangeRequests)
      .where(and(eq(artistProfileChangeRequests.personnelId, personnelId), eq(artistProfileChangeRequests.status, PENDING_STATUS)))
      .limit(1),
  ]);
  return {
    details: detailsOf(profile),
    submittedAt: profile?.submittedAt ?? null,
    importedFromFormAt: profile?.importedFromFormAt ?? null,
    files,
    pendingChange: pending
      ? { id: pending.id, fields: Object.keys(pending.changes).map((k) => ARTIST_FIELD_LABELS[k as keyof ArtistDetailsInput] ?? k), reason: pending.reason, createdAt: pending.createdAt }
      : null,
  };
}

/** An artist's own details, in full, for their My details page. */
export async function getOwnArtistDetails(personnelId: string): Promise<ArtistDetailsView> {
  return viewFor(personnelId);
}

/**
 * Keeps an uploaded document: its Drive link and a copy of its bytes.
 *
 * Input: whose document, what kind, the file, its Drive link (null when Drive failed), and who uploaded it.
 * Output: the stored file.
 */
export async function recordArtistFile(file: {
  personnelId: string;
  kind: ArtistDocumentKind;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  driveUrl: string | null;
  uploadedBy: string | null;
}): Promise<ArtistFileView> {
  const [row] = await db
    .insert(artistProfileFiles)
    .values({
      personnelId: file.personnelId,
      kind: file.kind,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.length,
      driveUrl: file.driveUrl,
      bytes: file.bytes,
      uploadedBy: file.uploadedBy,
    })
    .returning(fileColumns);
  return row;
}

// Every document id in the details must be one of this artist's own files.
async function assertOwnFiles(personnelId: string, details: ArtistDetailsInput): Promise<void> {
  const ids = ARTIST_DOCUMENT_KINDS.map((d) => details[d.column]).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  const owned = await db
    .select({ id: artistProfileFiles.id })
    .from(artistProfileFiles)
    .where(and(inArray(artistProfileFiles.id, ids), eq(artistProfileFiles.personnelId, personnelId)));
  if (owned.length !== new Set(ids).size) throw new ArtistDetailsError("One of those documents isn't yours");
}

/**
 * Saves an artist's details the first time and tells the team. After this, changes go through
 * requestArtistDetailsChange.
 *
 * Input: the artist, their details, and who saved them. Output: nothing. Throws ArtistDetailsError
 * when details are missing or malformed, or were already saved.
 */
export async function saveFirstArtistDetails(personnelId: string, input: ArtistDetailsInput, actorId: string | null): Promise<void> {
  const artist = await loadArtist(personnelId);
  const profile = await loadProfile(personnelId);
  if (profile?.submittedAt) throw new ArtistDetailsError("Your details are already saved. Ask for a change instead.");
  const details = normaliseDetails(input);
  const problem = checkDetails(details);
  if (problem) throw new ArtistDetailsError(problem);
  await assertOwnFiles(personnelId, details);

  const now = new Date();
  await db.transaction(async (tx) => {
    if (profile) await tx.update(artistProfiles).set({ ...details, submittedAt: now, updatedAt: now }).where(eq(artistProfiles.id, profile.id));
    else await tx.insert(artistProfiles).values({ personnelId, ...details, submittedAt: now });
    await tx.insert(auditLog).values({ action: "saveArtistDetails", entityType: DETAILS_ENTITY, entityId: personnelId, actorId, payload: { first: true } });
  });
  await notifyTeamOfArtistDetails(artist, { kind: "saved" });
}

/**
 * Asks to change saved details. The old details stay in use until someone who pays artists approves.
 *
 * Input: the artist, the details as they should be, the artist's reason, and who asked.
 * Output: nothing. Throws ArtistDetailsError for nothing changed, a missing reason, a malformed
 * value, or a change already waiting.
 */
export async function requestArtistDetailsChange(personnelId: string, input: ArtistDetailsInput, reason: string, actorId: string | null): Promise<void> {
  const artist = await loadArtist(personnelId);
  const profile = await loadProfile(personnelId);
  if (!profile?.submittedAt) throw new ArtistDetailsError("Save your details first");
  if (!reason.trim()) throw new ArtistDetailsError("Say why the details are changing");
  const [pending] = await db
    .select({ id: artistProfileChangeRequests.id })
    .from(artistProfileChangeRequests)
    .where(and(eq(artistProfileChangeRequests.personnelId, personnelId), eq(artistProfileChangeRequests.status, PENDING_STATUS)))
    .limit(1);
  if (pending) throw new ArtistDetailsError("You already have a change waiting for approval");

  const next = normaliseDetails(input);
  const problem = checkDetails(next);
  if (problem) throw new ArtistDetailsError(problem);
  await assertOwnFiles(personnelId, next);
  const changes = changedFields(detailsOf(profile), next);
  const fields = Object.keys(changes) as (keyof ArtistDetailsInput)[];
  if (fields.length === 0) throw new ArtistDetailsError("Nothing changed");

  await db.transaction(async (tx) => {
    await tx.insert(artistProfileChangeRequests).values({ personnelId, changes: changes as Record<string, string | null>, reason: reason.trim() });
    await tx.insert(auditLog).values({ action: "requestArtistDetailsChange", entityType: DETAILS_ENTITY, entityId: personnelId, actorId, payload: { fields } });
  });
  await notifyTeamOfArtistDetails(artist, { kind: "change_requested", fields: fields.map((f) => ARTIST_FIELD_LABELS[f]), reason: reason.trim() });
}

/**
 * Approves a change (its values replace the saved details) or declines it, and tells the artist.
 *
 * Input: the request, the decision, an optional note, and who decided. Output: nothing.
 */
export async function decideArtistDetailsChange(requestId: string, approve: boolean, note: string | null, actorId: string | null): Promise<void> {
  const [request] = await db.select().from(artistProfileChangeRequests).where(eq(artistProfileChangeRequests.id, requestId)).limit(1);
  if (!request) throw new ArtistDetailsNotFoundError("No such change request");
  if (request.status !== PENDING_STATUS) throw new ArtistDetailsError("That change was already decided");
  const artist = await loadArtist(request.personnelId);
  const now = new Date();
  await db.transaction(async (tx) => {
    if (approve) {
      await tx
        .update(artistProfiles)
        .set({ ...(request.changes as Partial<ArtistDetailsInput>), updatedAt: now })
        .where(eq(artistProfiles.personnelId, request.personnelId));
    }
    await tx
      .update(artistProfileChangeRequests)
      .set({ status: approve ? "approved" : "rejected", decidedBy: actorId, decidedAt: now, decisionNote: note?.trim() || null })
      .where(eq(artistProfileChangeRequests.id, requestId));
    await tx.insert(auditLog).values({
      action: approve ? "approveArtistDetailsChange" : "rejectArtistDetailsChange",
      entityType: DETAILS_ENTITY,
      entityId: request.personnelId,
      actorId,
      payload: { requestId, fields: Object.keys(request.changes) },
    });
  });
  await notifyArtistOfDetailsDecision(artist, approve, note?.trim() || null);
}

export interface TeamArtistRow {
  id: string;
  name: string;
  email: string;
  /** missing: nothing yet; imported: only what came from the onboarding form; saved: filled in by the artist. */
  state: "missing" | "imported" | "saved";
  maskedAccount: string | null;
  maskedUpi: string | null;
  submittedAt: Date | null;
  pendingChanges: number;
  hasDiscord: boolean;
}

/** Every Active artist with where their details stand, numbers masked. For the team's Artist details page. */
export async function listArtistDetailsForTeam(): Promise<TeamArtistRow[]> {
  const [artists, profiles, pending] = await Promise.all([
    db
      .select({ id: personnel.id, name: personnel.name, email: personnel.email, discordUserId: personnel.discordUserId })
      .from(personnel)
      .where(and(eq(personnel.status, "Active"), sql`${ARTIST_ROLE} = any (select lower(r) from unnest(${personnel.roles}) as r)`))
      .orderBy(asc(personnel.name)),
    db.select().from(artistProfiles),
    db
      .select({ personnelId: artistProfileChangeRequests.personnelId, total: count() })
      .from(artistProfileChangeRequests)
      .where(eq(artistProfileChangeRequests.status, PENDING_STATUS))
      .groupBy(artistProfileChangeRequests.personnelId),
  ]);
  const profileOf = new Map(profiles.map((p) => [p.personnelId, p]));
  const pendingOf = new Map(pending.map((p) => [p.personnelId, p.total]));
  return artists.map((a) => {
    const profile = profileOf.get(a.id);
    return {
      id: a.id,
      name: a.name,
      email: a.email,
      state: profile?.submittedAt ? "saved" : profile ? "imported" : "missing",
      maskedAccount: maskNumber(profile?.bankAccountNumber ?? null),
      maskedUpi: maskNumber(profile?.upiId ?? null),
      submittedAt: profile?.submittedAt ?? null,
      pendingChanges: pendingOf.get(a.id) ?? 0,
      hasDiscord: Boolean(a.discordUserId),
    };
  });
}

/**
 * One artist's details in full, for someone who pays artists, with any change waiting. Every call
 * is logged, since it shows bank numbers.
 *
 * Input: the artist and who is looking. Output: the details, documents and pending change, plus the
 * artist's name and email.
 */
export async function revealArtistDetails(personnelId: string, actorId: string | null) {
  const artist = await loadArtist(personnelId);
  const view = await viewFor(personnelId);
  const [pendingRow] = view.pendingChange
    ? await db.select({ changes: artistProfileChangeRequests.changes }).from(artistProfileChangeRequests).where(eq(artistProfileChangeRequests.id, view.pendingChange.id))
    : [];
  await db.insert(auditLog).values({ action: "revealArtistDetails", entityType: DETAILS_ENTITY, entityId: personnelId, actorId, payload: {} });
  return { artist: { id: artist.id, name: artist.name, email: artist.email }, ...view, pendingValues: (pendingRow?.changes ?? null) as Partial<ArtistDetailsInput> | null };
}

/** One stored document with its bytes, for viewing; null when there's no such file. */
export async function readArtistFile(fileId: string) {
  const [file] = await db.select().from(artistProfileFiles).where(eq(artistProfileFiles.id, fileId)).limit(1);
  return file ?? null;
}

/**
 * Asks every Active artist who hasn't saved their details to fill in My details: a Discord message,
 * and an email for those whose onboarding-form documents were copied in.
 *
 * Input: who sent it, and whether to only count who would be messaged. Output: who was messaged.
 */
export async function remindArtistsToAddDetails(actorId: string | null, options: { dryRun: boolean }) {
  const rows = await listArtistDetailsForTeam();
  const targets = rows.filter((r) => r.state !== "saved");
  const results: { name: string; discord: boolean; email: boolean }[] = [];
  for (const target of targets) {
    if (options.dryRun) {
      results.push({ name: target.name, discord: target.hasDiscord, email: target.state === "imported" });
      continue;
    }
    const artist = await loadArtist(target.id);
    const discord = await messageArtistOnDiscord(artist, detailsReminderText(artist.name, target.state === "imported"));
    if (target.state === "imported") await emailArtistToVerifyDetails(artist);
    results.push({ name: target.name, discord, email: target.state === "imported" });
  }
  if (!options.dryRun) {
    await db.insert(auditLog).values({ action: "remindArtistDetails", entityType: DETAILS_ENTITY, entityId: null, actorId, payload: { artists: results.map((r) => r.name) } });
  }
  return results;
}
