// Arjun's sign-off on assets the team adds. An asset added by anyone but an admin waits in
// "Waiting for sign-off" (status "curated"), off the board, until he approves it onto the board,
// sends it back to whoever added it with feedback, or drops it. A digest email every 2 hours lists
// what's new in his queue.

import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { assetSignoffs } from "@/lib/db/schema/asset_signoffs";
import { personnel } from "@/lib/db/schema/personnel";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { getKanbanBoardData, updateAssetStatusInKanban, type KanbanAssetCard } from "@/lib/kanban/kanban-service";
import type { CapabilitySet } from "@/lib/auth/rbac";
import { hideAssetFromBoard } from "@/lib/assets/board-visibility";
import { APPROVED, DROPPED, SENT_BACK, SIGNOFF_STATUS, WAITING, inDigestHours, signsOff, type SignoffState } from "./signoff-rules";
import { notifySubmitterOfDecision, sendSignoffDigestEmail, type DigestItem } from "./signoff-notifications";

const SIGNOFF_ENTITY = "asset";
const LAST_DIGEST_KEY = "signoff_digest_last_at";
const MAX_FEEDBACK_CHARS = 5_000;

export class SignoffError extends Error {
  constructor(
    message: string,
    readonly httpStatus = 400
  ) {
    super(message);
  }
}

export interface SignoffActor {
  personnelId: string | null;
  roles: string[];
  caps: CapabilitySet;
}

/** One asset on the Sign-off page: the board's card for it plus its sign-off. */
export interface SignoffItem {
  card: KanbanAssetCard;
  state: SignoffState;
  feedback: string | null;
  submittedAt: Date;
  submittedById: string | null;
  submittedByName: string | null;
}

/**
 * Marks a just-added asset as waiting for sign-off. Called by the asset create route for anyone who
 * doesn't sign off themselves.
 *
 * Input: the asset's row id and who added it. Output: nothing.
 */
export async function recordSignoffRequest(assetId: string, submittedBy: string | null): Promise<void> {
  await db.insert(assetSignoffs).values({ assetId, submittedBy, state: WAITING }).onConflictDoNothing();
}

/**
 * Everything on the Sign-off page: assets waiting for Arjun, and assets sent back to whoever added
 * them, newest first. Assets that were dropped are hidden from the board, so they aren't listed.
 *
 * Output: the items, each with the board's card so the page can show and edit it like the board does.
 */
export async function listSignoffs(): Promise<SignoffItem[]> {
  const { columns } = await getKanbanBoardData(undefined, { showCurated: true });
  const cards = columns.find((c) => c.key === SIGNOFF_STATUS)?.assets ?? [];
  if (cards.length === 0) return [];
  const rows = await db
    .select({ signoff: assetSignoffs, submittedByName: personnel.name })
    .from(assetSignoffs)
    .leftJoin(personnel, eq(personnel.id, assetSignoffs.submittedBy))
    .where(inArray(assetSignoffs.assetId, cards.map((c) => c.id)));
  const byAsset = new Map(rows.map((r) => [r.signoff.assetId, r]));
  return cards
    .map((card) => {
      const row = byAsset.get(card.id);
      return {
        card,
        // An asset left in the old Curated column from the curation trial has no row, and a dropped
        // asset someone put back from Hidden cards is visible again: both are waiting.
        state: row && row.signoff.state !== DROPPED ? (row.signoff.state as SignoffState) : WAITING,
        feedback: row?.signoff.feedback ?? null,
        submittedAt: row?.signoff.submittedAt ?? new Date(card.updatedAt),
        submittedById: row?.signoff.submittedBy ?? null,
        submittedByName: row?.submittedByName ?? null,
      };
    })
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
}

async function loadForDecision(sku: string) {
  const [row] = await db
    .select({ asset: assets, signoff: assetSignoffs })
    .from(assets)
    .leftJoin(assetSignoffs, eq(assetSignoffs.assetId, assets.id))
    .where(eq(assets.sku, sku))
    .limit(1);
  if (!row) throw new SignoffError(`No asset ${sku}`, 404);
  if (row.asset.currentStatus !== SIGNOFF_STATUS) throw new SignoffError(`${sku} isn't waiting for sign-off`);
  return row;
}

function assertSignsOff(actor: SignoffActor): void {
  if (!signsOff(actor.roles)) throw new SignoffError("Only Arjun signs assets off", 403);
}

// Writes the decision on the sign-off row, creating it for an asset left over from the curation trial.
async function setState(assetId: string, state: SignoffState, actorId: string | null, feedback?: string | null): Promise<void> {
  const now = new Date();
  const values = { state, decidedBy: actorId, decidedAt: now, updatedAt: now, ...(feedback !== undefined ? { feedback } : {}) };
  await db
    .insert(assetSignoffs)
    .values({ assetId, ...values })
    .onConflictDoUpdate({ target: assetSignoffs.assetId, set: values });
}

/**
 * Signs assets off onto the board: each moves to Unassigned, and whoever added it is told.
 *
 * Input: the SKUs and who approved them (an admin). Output: the SKUs approved. Throws SignoffError
 * for a non-admin, or an asset that isn't waiting.
 */
export async function approveSignoffs(skus: string[], actor: SignoffActor): Promise<string[]> {
  assertSignsOff(actor);
  const approved: string[] = [];
  for (const sku of skus) {
    const { asset, signoff } = await loadForDecision(sku);
    await updateAssetStatusInKanban(sku, "unassigned", { roles: actor.roles, personnelId: actor.personnelId ?? undefined, caps: actor.caps }, "Signed off onto the board");
    await setState(asset.id, APPROVED, actor.personnelId);
    await db.insert(auditLog).values({ action: "approveSignoff", entityType: SIGNOFF_ENTITY, entityId: asset.id, actorId: actor.personnelId, payload: { sku } });
    await notifySubmitterOfDecision({ submitterId: signoff?.submittedBy ?? null, sku, itemName: asset.itemName, decision: "approved", feedback: null });
    approved.push(sku);
  }
  return approved;
}

/**
 * Sends an asset back to whoever added it, with what to change. It stays off the board until they
 * resubmit it and Arjun approves it.
 *
 * Input: the SKU, the feedback, and who sent it back (an admin). Output: nothing.
 */
export async function sendBackSignoff(sku: string, feedback: string, actor: SignoffActor): Promise<void> {
  assertSignsOff(actor);
  const note = feedback.trim();
  if (!note) throw new SignoffError("Say what to change");
  if (note.length > MAX_FEEDBACK_CHARS) throw new SignoffError(`Keep the feedback under ${MAX_FEEDBACK_CHARS} characters`);
  const { asset, signoff } = await loadForDecision(sku);
  await setState(asset.id, SENT_BACK, actor.personnelId, note);
  await db.insert(auditLog).values({ action: "sendBackSignoff", entityType: SIGNOFF_ENTITY, entityId: asset.id, actorId: actor.personnelId, payload: { sku, feedback: note } });
  await notifySubmitterOfDecision({ submitterId: signoff?.submittedBy ?? null, sku, itemName: asset.itemName, decision: "sent_back", feedback: note });
}

/**
 * Drops an asset: it's taken off the board for good (hidden, not deleted, so it can be put back
 * from the board's Hidden cards) and whoever added it is told.
 *
 * Input: the SKU, an optional reason, and who dropped it (an admin). Output: nothing.
 */
export async function dropSignoff(sku: string, reason: string | null, actor: SignoffActor): Promise<void> {
  assertSignsOff(actor);
  const { asset, signoff } = await loadForDecision(sku);
  await setState(asset.id, DROPPED, actor.personnelId, reason?.trim() || null);
  await hideAssetFromBoard(sku, actor.personnelId);
  await db.insert(auditLog).values({ action: "dropSignoff", entityType: SIGNOFF_ENTITY, entityId: asset.id, actorId: actor.personnelId, payload: { sku, reason } });
  await notifySubmitterOfDecision({ submitterId: signoff?.submittedBy ?? null, sku, itemName: asset.itemName, decision: "dropped", feedback: reason?.trim() || null });
}

/**
 * Sends a sent-back asset to Arjun again after the changes. Only whoever added it, or an admin.
 *
 * Input: the SKU and who resubmitted it. Output: nothing.
 */
export async function resubmitSignoff(sku: string, actor: SignoffActor): Promise<void> {
  const { asset, signoff } = await loadForDecision(sku);
  if (!signsOff(actor.roles) && signoff?.submittedBy !== actor.personnelId) throw new SignoffError("Only whoever added it can resubmit it", 403);
  if (signoff?.state !== SENT_BACK) throw new SignoffError(`${sku} is already waiting for sign-off`);
  const now = new Date();
  await db.update(assetSignoffs).set({ state: WAITING, submittedAt: now, updatedAt: now }).where(eq(assetSignoffs.assetId, asset.id));
  await db.insert(auditLog).values({ action: "resubmitSignoff", entityType: SIGNOFF_ENTITY, entityId: asset.id, actorId: actor.personnelId, payload: { sku } });
}

/**
 * Emails Arjun the assets that started (or restarted) waiting since the last digest. Sends nothing
 * outside 10:00-20:00 India time unless forced, or when nothing new is waiting.
 *
 * Input: the moment, and whether to ignore the hours. Output: how many assets the email listed (0 when none went).
 */
export async function sendSignoffDigest(now: Date, options: { force?: boolean } = {}): Promise<number> {
  if (!options.force && !inDigestHours(now)) return 0;
  const [last] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LAST_DIGEST_KEY)).limit(1);
  const since = typeof last?.value === "string" ? new Date(last.value) : new Date(0);

  const fresh = await db
    .select({ sku: assets.sku, itemName: assets.itemName, category: assets.category, referenceImages: assets.referenceImages, submittedAt: assetSignoffs.submittedAt, submittedByName: personnel.name })
    .from(assetSignoffs)
    .innerJoin(assets, eq(assets.id, assetSignoffs.assetId))
    .leftJoin(personnel, eq(personnel.id, assetSignoffs.submittedBy))
    .where(and(eq(assetSignoffs.state, WAITING), eq(assets.currentStatus, SIGNOFF_STATUS), gt(assetSignoffs.submittedAt, since)));
  if (fresh.length === 0) return 0;

  const waitingTotal = await db.$count(assetSignoffs, eq(assetSignoffs.state, WAITING));
  await sendSignoffDigestEmail(fresh as DigestItem[], waitingTotal);
  await db
    .insert(appSettings)
    .values({ key: LAST_DIGEST_KEY, value: now.toISOString(), updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: now.toISOString(), updatedAt: now } });
  return fresh.length;
}
