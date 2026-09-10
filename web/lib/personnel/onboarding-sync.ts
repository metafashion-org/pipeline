import { db } from "@/lib/db/client";
import { onboardingRequests } from "@/lib/db/schema/onboarding_requests";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { ARTIST_ACCESS_FORM_KEY, approveArtistAccessSubmission } from "@/lib/forms/onboarding";
import { isConfigured as isDiscordConfigured } from "@/lib/discord/discord-service";
import { getDiscordOverview, type OverviewMember } from "@/lib/discord/team-service";
import { invalidatePersonnelAuthCache } from "@/lib/auth/personnel-auth";

// Brings onboarding requests from both routes into one list, and writes each decision back to the
// route it came from.
//
// Inbound, per route:
//   email   — a submission of the public Artist Access Request form. The submitter reaches us by
//             email, which is the only contact detail that form collects.
//   discord — someone in the guild with no role bucket assigned. That is the same set the Discord
//             panel counts as "Pending (no role bucket)"; the difference is that they now appear
//             as rows an admin can act on rather than as a number.
//
// Nothing here grants access. Syncing only ever writes rows with status 'pending', and a person
// becomes personnel when an admin approves their request and not before. That is deliberate: the
// artist access form is public and unauthenticated, and anyone can join a Discord server, so
// either route would otherwise be a way to grant yourself an account.
//
// Outbound, on a decision: an email request updates its form_submissions row, and an approved
// Discord request writes the member's Discord id onto the personnel record so the two systems
// point at each other afterwards.

export const ONBOARDING_SOURCES = ["email", "discord"] as const;
export type OnboardingSource = (typeof ONBOARDING_SOURCES)[number];

export const ONBOARDING_STATUSES = ["pending", "approved", "rejected"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export interface OnboardingRequestRow {
  id: string;
  source: OnboardingSource;
  externalId: string;
  name: string | null;
  email: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  details: Record<string, unknown>;
  status: OnboardingStatus;
  personnelId: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  requestedAt: string | null;
  firstSeenAt: string;
}

export interface SyncResult {
  emailFound: number;
  discordFound: number;
  created: number;
  updated: number;
  /** Set when one side could not be reached. The other side's results still stand. */
  warning?: string;
}

/**
 * Picks the Discord members who count as onboarding requests.
 *
 * Input: the guild's members as the overview reports them, and the Discord user ids already linked to a personnel record. Output: the members who are in the server, carry no role bucket, and are not already someone this app knows about.
 *
 * Kept separate from the Discord call so the rule is covered by a unit test rather than only by a live guild. A member with an "Artist: X" role has already been onboarded on the Discord side and is not a request; a member already linked to personnel has been onboarded here.
 */
export function selectDiscordOnboardingCandidates(
  members: OverviewMember[],
  linkedDiscordUserIds: Set<string>
): OverviewMember[] {
  return members.filter((m) => m.status === "pending" && !linkedDiscordUserIds.has(m.id));
}

/** The artist access form's id, or null when that form has not been created yet. */
async function getArtistAccessFormId(): Promise<string | null> {
  const [form] = await db
    .select({ id: formDefinitions.id })
    .from(formDefinitions)
    .where(eq(formDefinitions.key, ARTIST_ACCESS_FORM_KEY))
    .limit(1);
  return form?.id ?? null;
}

interface UpsertInput {
  source: OnboardingSource;
  externalId: string;
  name: string | null;
  email: string | null;
  discordUserId: string | null;
  discordUsername: string | null;
  details: Record<string, unknown>;
  requestedAt: Date | null;
  /** Only set when the source itself already recorded a decision, so the two lists agree. */
  statusFromSource?: OnboardingStatus;
}

/**
 * Writes one request in, without ever moving a decided request back to pending.
 *
 * Input: what the source knows about the request. Output: whether a row was created or an existing one updated.
 *
 * The contact details are refreshed on every sync, because someone can change their Discord display name between one run and the next. The status is only ever written from the source when the source has decided — an approval recorded here is never undone by a later sync.
 */
async function upsertRequest(input: UpsertInput): Promise<"created" | "updated"> {
  const [existing] = await db
    .select()
    .from(onboardingRequests)
    .where(and(eq(onboardingRequests.source, input.source), eq(onboardingRequests.externalId, input.externalId)))
    .limit(1);

  if (!existing) {
    await db.insert(onboardingRequests).values({
      source: input.source,
      externalId: input.externalId,
      name: input.name,
      email: input.email,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      details: input.details,
      requestedAt: input.requestedAt,
      status: input.statusFromSource ?? "pending",
    });
    return "created";
  }

  const patch: Partial<typeof onboardingRequests.$inferInsert> = {
    name: input.name,
    email: input.email,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername,
    details: input.details,
    requestedAt: input.requestedAt,
    updatedAt: new Date(),
  };

  // Mirroring the source's own decision is the inbound half of the two-way sync: a submission
  // approved through the older /admin/personnel path, or by hand in the database, must not sit in
  // this list as though nobody had looked at it.
  if (input.statusFromSource && input.statusFromSource !== "pending" && existing.status === "pending") {
    patch.status = input.statusFromSource;
    patch.reviewedAt = new Date();
    patch.reviewNotes = existing.reviewNotes ?? `Decided at the source (${input.source}) rather than here.`;
  }

  await db.update(onboardingRequests).set(patch).where(eq(onboardingRequests.id, existing.id));
  return "updated";
}

/** Pulls the artist access form's submissions in. Returns how many submissions were seen. */
async function syncEmailRequests(): Promise<{ found: number; created: number; updated: number }> {
  const formId = await getArtistAccessFormId();
  if (!formId) return { found: 0, created: 0, updated: 0 };

  const submissions = await db
    .select()
    .from(formSubmissions)
    .where(eq(formSubmissions.formDefinitionId, formId))
    .orderBy(asc(formSubmissions.createdAt));

  let created = 0;
  let updated = 0;
  for (const s of submissions) {
    const values = (s.values as Record<string, unknown>) || {};
    const email = String(s.submitterEmail || values.email || "").trim().toLowerCase();
    const name = String(values.fullName || "").trim() || null;
    const status = ONBOARDING_STATUSES.includes(s.status as OnboardingStatus)
      ? (s.status as OnboardingStatus)
      : "pending";

    const result = await upsertRequest({
      source: "email",
      externalId: s.id,
      name,
      email: email || null,
      discordUserId: null,
      discordUsername: null,
      details: values,
      requestedAt: s.createdAt,
      statusFromSource: status,
    });
    if (result === "created") created++;
    else updated++;
  }

  return { found: submissions.length, created, updated };
}

/** Pulls unassigned Discord members in. Returns how many members qualified as requests. */
async function syncDiscordRequests(): Promise<{ found: number; created: number; updated: number }> {
  const overview = await getDiscordOverview();

  const linked = await db
    .select({ discordUserId: personnel.discordUserId })
    .from(personnel)
    .where(isNotNull(personnel.discordUserId));
  const linkedIds = new Set(linked.map((p) => p.discordUserId).filter((id): id is string => Boolean(id)));

  const candidates = selectDiscordOnboardingCandidates(overview.members, linkedIds);

  let created = 0;
  let updated = 0;
  for (const m of candidates) {
    const result = await upsertRequest({
      source: "discord",
      externalId: m.id,
      name: m.displayName,
      // Discord's API does not expose a member's email to a bot, so a Discord request has no
      // contact address until an admin supplies one at approval.
      email: null,
      discordUserId: m.id,
      discordUsername: m.rawUsername,
      details: { roles: m.roles, channels: m.channels },
      requestedAt: null,
    });
    if (result === "created") created++;
    else updated++;
  }

  return { found: candidates.length, created, updated };
}

/**
 * Runs both syncs and reports what came in.
 *
 * Input: nothing. Output: how many requests each route produced and how many rows were created or refreshed. When Discord cannot be reached, the email side's result still stands and the failure is reported as a warning rather than thrown — an unreachable bot must not hide the requests that arrived by form.
 */
export async function syncOnboardingRequests(): Promise<SyncResult> {
  const email = await syncEmailRequests();

  if (!isDiscordConfigured()) {
    return {
      emailFound: email.found,
      discordFound: 0,
      created: email.created,
      updated: email.updated,
      warning: "Discord isn't configured on this deployment, so only email requests were synced.",
    };
  }

  try {
    const discord = await syncDiscordRequests();
    return {
      emailFound: email.found,
      discordFound: discord.found,
      created: email.created + discord.created,
      updated: email.updated + discord.updated,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[onboarding-sync] Discord side failed:", message);
    return {
      emailFound: email.found,
      discordFound: 0,
      created: email.created,
      updated: email.updated,
      warning: `Couldn't reach Discord, so only email requests were synced: ${message}`,
    };
  }
}

function toRow(r: typeof onboardingRequests.$inferSelect): OnboardingRequestRow {
  return {
    id: r.id,
    source: r.source as OnboardingSource,
    externalId: r.externalId,
    name: r.name,
    email: r.email,
    discordUserId: r.discordUserId,
    discordUsername: r.discordUsername,
    details: (r.details as Record<string, unknown>) || {},
    status: r.status as OnboardingStatus,
    personnelId: r.personnelId,
    reviewNotes: r.reviewNotes,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    requestedAt: r.requestedAt ? r.requestedAt.toISOString() : null,
    firstSeenAt: r.firstSeenAt.toISOString(),
  };
}

/**
 * Reads the review list.
 *
 * Input: which statuses to include, defaulting to pending only. Output: the matching requests, oldest first, with dates as ISO strings.
 */
export async function listOnboardingRequests(
  statuses: OnboardingStatus[] = ["pending"]
): Promise<OnboardingRequestRow[]> {
  const rows = await db
    .select()
    .from(onboardingRequests)
    .where(inArray(onboardingRequests.status, statuses))
    .orderBy(asc(onboardingRequests.firstSeenAt));
  return rows.map(toRow);
}

export interface ApproveOnboardingRequestOptions {
  reviewerId?: string;
  reviewNotes?: string;
  /** Required for a Discord request, which carries no email of its own. Ignored for an email request, whose address is the one they applied with. */
  email?: string;
  /** Overrides the name the request came in with. */
  name?: string;
}

export interface ApproveOnboardingRequestResult {
  requestId: string;
  personnelId: string;
  email: string;
  /** Set when there is something the admin still has to do by hand, which this deliberately does not do for them. */
  followUp?: string;
}

/**
 * Approves one request and writes the decision back to where it came from.
 *
 * Input: the request id, who is approving it, and — for a Discord request — the email address to create the personnel record under. Output: the personnel record the approval produced, and any follow-up the admin still has to do by hand.
 *
 * An email request goes through approveArtistAccessSubmission, the same path the older review screen used, so the form submission is marked approved as part of the same decision. A Discord request creates or reactivates the personnel record and links the member's Discord id to it. It does not assign a Discord role or create their channel: that needs a department, which only a person can choose, and it lives in the Discord Team Manager.
 */
export async function approveOnboardingRequest(
  requestId: string,
  options: ApproveOnboardingRequestOptions = {}
): Promise<ApproveOnboardingRequestResult> {
  const [request] = await db.select().from(onboardingRequests).where(eq(onboardingRequests.id, requestId)).limit(1);
  if (!request) throw new Error("Onboarding request not found");
  if (request.status !== "pending") throw new Error(`This request was already ${request.status}.`);

  const { reviewerId, reviewNotes } = options;

  if (request.source === "email") {
    const result = await approveArtistAccessSubmission(request.externalId, reviewerId, reviewNotes);
    await db
      .update(onboardingRequests)
      .set({
        status: "approved",
        personnelId: result.personnelId,
        email: result.email,
        reviewedBy: reviewerId || null,
        reviewNotes: reviewNotes || "Access granted by admin",
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(onboardingRequests.id, requestId));

    return { requestId, personnelId: result.personnelId, email: result.email };
  }

  // Discord source.
  const email = (options.email || request.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error(
      "Discord doesn't give us an email address, so approving a Discord request needs one — add the address this person should sign in with."
    );
  }
  const name = (options.name || request.name || request.discordUsername || "Artist").trim();

  const [existing] = await db.select().from(personnel).where(eq(personnel.email, email)).limit(1);
  let personnelId: string;

  if (existing) {
    const roles = Array.from(new Set([...(existing.roles || []), "artist"]));
    await db
      .update(personnel)
      .set({
        name,
        roles,
        status: "Active",
        // The outbound half of the sync: from here the personnel record and the Discord member
        // point at each other, so the next sync knows this member is no longer a request.
        discordUserId: request.discordUserId,
        updatedAt: new Date(),
      })
      .where(eq(personnel.id, existing.id));
    personnelId = existing.id;
  } else {
    const [created] = await db
      .insert(personnel)
      .values({
        name,
        email,
        roles: ["artist"],
        status: "Active",
        dateOnboarded: new Date(),
        discordUserId: request.discordUserId,
      })
      .returning();
    personnelId = created.id;
  }

  await db
    .update(onboardingRequests)
    .set({
      status: "approved",
      personnelId,
      email,
      reviewedBy: reviewerId || null,
      reviewNotes: reviewNotes || "Access granted by admin",
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(onboardingRequests.id, requestId));

  await db.insert(auditLog).values({
    action: "approveOnboardingRequest",
    entityType: "personnel",
    entityId: personnelId,
    actorId: reviewerId || null,
    payload: { requestId, source: "discord", email, name, discordUserId: request.discordUserId },
  });

  // A revoked or newly-granted login must take effect on the next request, not when the auth cache
  // happens to lapse.
  invalidatePersonnelAuthCache(email);

  return {
    requestId,
    personnelId,
    email,
    followUp: "They now have pipeline access. Their Discord role and channel still need creating — do that from the Discord Team Manager, which asks which department they're in.",
  };
}

/**
 * Rejects one request and writes the decision back to where it came from.
 *
 * Input: the request id, who is rejecting it, and an optional reason. Output: nothing. An email request's form_submissions row is marked rejected so the two lists agree; a Discord request is only marked here — nobody is removed from the server, which stays a deliberate action in the Discord Team Manager.
 */
export async function rejectOnboardingRequest(
  requestId: string,
  reviewerId?: string,
  reviewNotes?: string
): Promise<void> {
  const [request] = await db.select().from(onboardingRequests).where(eq(onboardingRequests.id, requestId)).limit(1);
  if (!request) throw new Error("Onboarding request not found");
  if (request.status !== "pending") throw new Error(`This request was already ${request.status}.`);

  const notes = reviewNotes || "Request declined by admin";

  if (request.source === "email") {
    await db
      .update(formSubmissions)
      .set({
        status: "rejected",
        reviewedBy: reviewerId || null,
        reviewNotes: notes,
        reviewedAt: new Date(),
      })
      .where(eq(formSubmissions.id, request.externalId));
  }

  await db
    .update(onboardingRequests)
    .set({
      status: "rejected",
      reviewedBy: reviewerId || null,
      reviewNotes: notes,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(onboardingRequests.id, requestId));

  await db.insert(auditLog).values({
    action: "rejectOnboardingRequest",
    entityType: "onboarding_request",
    entityId: requestId,
    actorId: reviewerId || null,
    payload: { source: request.source, externalId: request.externalId, reason: notes },
  });
}
