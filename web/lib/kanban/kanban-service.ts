import { db } from "@/lib/db/client";
import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitionRules } from "@/lib/db/schema/status_transition_rules";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, and, asc, sql } from "drizzle-orm";

export interface KanbanColumnData {
  key: string;
  label: string;
  sortOrder: number;
  description: string | null;
  whoCanMoveIn: string | string[] | null;
  nextActionHint: string | null;
  automationNote: string | null;
  assets: KanbanAssetCard[];
}

export interface KanbanAssetCard {
  id: string;
  sku: string;
  itemName: string;
  category: string | null;
  currentStatus: string;
  feeAmount: string | null;
  currency: string | null;
  artistId: string | null;
  artistName: string | null;
  artistEmail: string | null;
  // Full deep-link (https://discord.com/channels/{guild}/{channel}), built
  // server-side so the client never needs the guild id as a public env var.
  // Null when the artist hasn't been linked to a Discord channel yet — see
  // HANDOFF.md's Discord/personnel migration notes.
  artistDiscordUrl: string | null;
  gmailThreadId: string | null;
  deadline: Date | null;
  updatedAt: Date;
  // Raw JSONB straight from the assets table. Parse with parseDriveRefs (lib/assets/drive-links.ts) before rendering: one cell can hold several comma-joined Drive URLs, or free text that is not a link at all.
  referenceImages: unknown;
  recolorReferenceImages: unknown;
}

/**
 * A KanbanAssetCard as the board component actually holds it.
 *
 * The two date fields are genuinely either type there, and which one depends on where the card
 * came from: the server render passes real Dates through the server-component boundary, while a
 * revalidation reads /api/assets over JSON and gets ISO strings. The board swaps between the two
 * sources as SWR refetches, so a component receiving a card has to cope with both. It was typed
 * `any`, which hid that rather than answering it.
 */
export type KanbanAssetCardClient = Omit<KanbanAssetCard, "deadline" | "updatedAt"> & {
  deadline: string | Date | null;
  updatedAt: string | Date;
};

/** A KanbanColumnData holding client-shaped cards. */
export type KanbanColumnDataClient = Omit<KanbanColumnData, "assets"> & { assets: KanbanAssetCardClient[] };

export async function getKanbanBoardData(artistEmail?: string): Promise<{ columns: KanbanColumnData[] }> {
  // The status config and the asset list are independent, so they are fetched concurrently.
  // Awaiting them in sequence spent two full network round trips where one would do, which is the dominant cost of rendering this page against a remote database.
  const [allStatuses, fetchedAssets] = await Promise.all([
    db.select().from(statuses).orderBy(asc(statuses.sortOrder)),
    db
    .select({
      id: assets.id,
      sku: assets.sku,
      itemName: assets.itemName,
      category: assets.category,
      currentStatus: assets.currentStatus,
      feeAmount: assets.feeAmount,
      currency: assets.currency,
      artistId: assets.currentArtistId,
      artistName: personnel.name,
      artistEmail: personnel.email,
      artistDiscordChannelId: personnel.discordChannelId,
      gmailThreadId: assets.gmailThreadId,
      deadline: assets.deadline,
      updatedAt: assets.updatedAt,
      referenceImages: assets.referenceImages,
      recolorReferenceImages: assets.recolorReferenceImages,
    })
    .from(assets)
    .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
    // Filter in the query rather than after it. An artist's board read every asset in the
    // table and then discarded all but their own in JavaScript, on every page load. Compared
    // lowercase on both sides so this keeps the case-insensitive behaviour the filter had.
    .where(artistEmail ? sql`lower(${personnel.email}) = ${artistEmail.toLowerCase()}` : undefined),
  ]);

  const guildId = process.env.DISCORD_GUILD_ID;

  // Maps the raw query row (which selected the artist's discordChannelId, an
  // internal id) into the public KanbanAssetCard shape (a full deep-link URL,
  // built here so the client never needs the guild id as a public env var).
  const allAssets: KanbanAssetCard[] = fetchedAssets.map(({ artistDiscordChannelId, ...rest }) => ({
    ...rest,
    artistDiscordUrl: artistDiscordChannelId && guildId ? `https://discord.com/channels/${guildId}/${artistDiscordChannelId}` : null,
  }));

  const columnsMap = new Map<string, KanbanColumnData>();

  for (const s of allStatuses) {
    columnsMap.set(s.key, {
      key: s.key,
      label: s.label,
      sortOrder: s.sortOrder,
      description: s.description,
      whoCanMoveIn: s.whoCanMoveIn,
      nextActionHint: s.nextActionHint,
      automationNote: s.automationNote,
      assets: [],
    });
  }

  for (const a of allAssets) {
    const col = columnsMap.get(a.currentStatus);
    if (col) {
      col.assets.push(a);
    } else {
      // Fallback column if unassigned or unrecognized status
      const unassignedCol = columnsMap.get("unassigned");
      if (unassignedCol) {
        unassignedCol.assets.push(a);
      }
    }
  }

  return {
    columns: Array.from(columnsMap.values()).sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

// Payment gate is structural per PLAN.md §4/§9: the admin override below is deliberately
// scoped to exclude these two statuses, so admin flexibility covers normal workflow
// movement but never skipping the financial gate.
//
// The gate was previously described as "encoded as an absence of rows in
// status_transition_rules, so it can't be bypassed via direct API calls." That was not
// true of the shipped data: lib/db/seed-statuses.ts seeds rows for both
// uploaded_to_roblox -> marked_for_payment and marked_for_payment -> payment_done. Because
// the rows exist with isAllowed true, the transition passed for every caller and the
// override exclusion never came into play. What actually gates them now is the role check
// below, which reads the `role` those seeded rows already carry.
const PAYMENT_GATED_STATUSES = ["marked_for_payment", "payment_done"];

// Who is asking for the transition. `system` is for transitions the pipeline performs on
// its own behalf in response to a real event (an assignment email going out, a valid final
// file arriving) rather than someone dragging a card — those have no human role to check,
// and the event that triggered them is authorised at its own entry point.
export type TransitionActor =
  | { system: true }
  | { system?: false; roles: string[]; personnelId?: string };

function actorRoles(actor: TransitionActor | undefined): Set<string> {
  if (!actor || actor.system) return new Set();
  return new Set(actor.roles.map((r) => r.toLowerCase()));
}

/**
 * Decides whether this actor may move a card into this status.
 *
 * Input: the actor, the matching status_transition_rules row (or undefined when none exists), and the target status row. Output: null when the move is permitted, or a sentence explaining the refusal.
 *
 * Two independent columns constrain a transition and both are honoured where set:
 * status_transition_rules.role names the single role a manual transition belongs to, and
 * statuses.who_can_move_in lists every role allowed to put a card in that column. Both were
 * seeded with real data and neither was read before — who_can_move_in was only ever rendered
 * into a tooltip. Admin satisfies both.
 */
function refuseTransition(
  actor: TransitionActor | undefined,
  rule: typeof statusTransitionRules.$inferSelect | undefined,
  targetStatus: typeof statuses.$inferSelect
): string | null {
  if (actor?.system) return null;

  const roles = actorRoles(actor);
  if (roles.has("admin")) return null;

  if (rule?.role && !roles.has(rule.role.toLowerCase())) {
    return `moving a card into '${targetStatus.key}' from '${rule.fromStatus}' is reserved for the '${rule.role}' role`;
  }

  const allowedIn = (targetStatus.whoCanMoveIn || []).map((r) => r.toLowerCase());
  if (allowedIn.length > 0 && !allowedIn.some((r) => roles.has(r))) {
    return `only ${allowedIn.join(", ")} can move a card into '${targetStatus.key}'`;
  }

  return null;
}

export async function updateAssetStatusInKanban(
  sku: string,
  targetStatusKey: string,
  actor?: TransitionActor,
  note?: string
) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) {
    throw new Error(`Asset with SKU '${sku}' not found`);
  }

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  if (fromStatus === targetStatusKey) {
    return { success: true, sku, currentStatus: targetStatusKey, changed: false };
  }

  // Validate target status key exists
  const targetStatus = await db.select().from(statuses).where(eq(statuses.key, targetStatusKey)).limit(1);
  if (targetStatus.length === 0) {
    throw new Error(`Target status key '${targetStatusKey}' is not a valid status`);
  }

  // Ownership: an artist may only move their own work. The board already filters cards by
  // artist email for display, but this function takes a SKU, so without this check an artist
  // could move any other artist's asset just by knowing its SKU. Anyone who can see the whole
  // board (operator, admin, and anyone granted canViewAllAssets) is exempt.
  const roles = actorRoles(actor);
  const isArtistOnly =
    !actor?.system && roles.has("artist") && !roles.has("admin") && !roles.has("operator");
  if (isArtistOnly && asset.currentArtistId !== (actor && !actor.system ? actor.personnelId : undefined)) {
    throw new Error(`Transition from '${fromStatus}' to '${targetStatusKey}' is forbidden: this asset is not assigned to you`);
  }

  // Check status transition rules: deny by default, per PLAN.md §4 - a transition is only
  // permitted if a matching row exists in status_transition_rules with isAllowed !== false.
  const rule = await db
    .select()
    .from(statusTransitionRules)
    .where(
      and(
        eq(statusTransitionRules.fromStatus, fromStatus),
        eq(statusTransitionRules.toStatus, targetStatusKey)
      )
    )
    .limit(1);

  if (rule.length === 0) {
    // Admin override, per PLAN.md §4/§5 ("admin: Everything... Override/repair records") -
    // but never for the two payment-gated statuses, which stay structurally deny-by-default
    // for every role including admin. See PAYMENT_GATED_STATUSES comment above.
    const adminOverride =
      (actor?.system || roles.has("admin")) && !PAYMENT_GATED_STATUSES.includes(targetStatusKey);
    if (!adminOverride) {
      throw new Error(`Transition from '${fromStatus}' to '${targetStatusKey}' is not permitted: no matching rule in status_transition_rules`);
    }
  } else if (!rule[0].isAllowed) {
    // An explicit forbid always applies, admin included - only the "no rule exists" gap
    // above gets the admin override, never an explicit isAllowed: false row.
    throw new Error(`Transition from '${fromStatus}' to '${targetStatusKey}' is forbidden: ${rule[0].failureReason || "Rule restriction"}`);
  }

  // A rule saying the transition is possible is not the same as this caller being allowed to
  // make it. Both status_transition_rules.role and statuses.who_can_move_in carry that answer
  // and neither was consulted before, which left every seeded transition open to any
  // authenticated user - including uploaded_to_roblox -> marked_for_payment.
  const refusal = refuseTransition(actor, rule[0], targetStatus[0]);
  if (refusal) {
    throw new Error(`Transition from '${fromStatus}' to '${targetStatusKey}' is forbidden: ${refusal}`);
  }

  const actorPersonnelId = actor && !actor.system ? actor.personnelId ?? null : null;

  // Receipt gate, structural like PAYMENT_GATED_STATUSES above: a client requirement
  // (admin must attach a payment receipt before marking a task paid) enforced here so
  // it holds for every role including admin, not just checked in the UI.
  if (targetStatusKey === "payment_done" && !asset.paymentReceiptUrl) {
    throw new Error(
      `Transition from '${fromStatus}' to 'payment_done' is forbidden: no payment receipt attached to this asset`
    );
  }

  // Update asset status
  await db
    .update(assets)
    .set({
      currentStatus: targetStatusKey,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, asset.id));

  // Insert status history
  await db.insert(statusHistory).values({
    assetId: asset.id,
    fromStatus,
    toStatus: targetStatusKey,
    actorId: actorPersonnelId,
    note: note || `Status updated via Kanban to ${targetStatusKey}`,
  });

  // Log audit event
  await db.insert(auditLog).values({
    action: "kanbanStatusChange",
    entityType: "asset",
    entityId: asset.id,
    actorId: actorPersonnelId,
    payload: { sku, fromStatus, toStatus: targetStatusKey, note },
  });

  return {
    success: true,
    sku,
    fromStatus,
    toStatus: targetStatusKey,
    changed: true,
  };
}
