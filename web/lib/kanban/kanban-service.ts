import { db } from "@/lib/db/client";
import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitionRules } from "@/lib/db/schema/status_transition_rules";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, and, asc } from "drizzle-orm";

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
    .leftJoin(personnel, eq(assets.currentArtistId, personnel.id)),
  ]);

  const guildId = process.env.DISCORD_GUILD_ID;

  // Maps the raw query row (which selected the artist's discordChannelId, an
  // internal id) into the public KanbanAssetCard shape (a full deep-link URL,
  // built here so the client never needs the guild id as a public env var).
  let allAssets: KanbanAssetCard[] = fetchedAssets.map(({ artistDiscordChannelId, ...rest }) => ({
    ...rest,
    artistDiscordUrl: artistDiscordChannelId && guildId ? `https://discord.com/channels/${guildId}/${artistDiscordChannelId}` : null,
  }));

  if (artistEmail) {
    allAssets = allAssets.filter(
      (a) => a.artistEmail && a.artistEmail.toLowerCase() === artistEmail.toLowerCase()
    );
  }

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

// Payment gate is structural per PLAN.md §4/§9: encoded as an absence of rows in
// status_transition_rules, "so it can't be bypassed via direct API calls." The admin
// override below is deliberately scoped to exclude these two statuses so that promise
// holds even for admins - admin flexibility is about normal workflow movement, not
// skipping the financial gate.
const PAYMENT_GATED_STATUSES = ["marked_for_payment", "payment_done"];

export async function updateAssetStatusInKanban(
  sku: string,
  targetStatusKey: string,
  role?: string,
  actorId?: string,
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
    const adminOverride = role === "admin" && !PAYMENT_GATED_STATUSES.includes(targetStatusKey);
    if (!adminOverride) {
      throw new Error(`Transition from '${fromStatus}' to '${targetStatusKey}' is not permitted: no matching rule in status_transition_rules`);
    }
  } else if (!rule[0].isAllowed) {
    // An explicit forbid always applies, admin included - only the "no rule exists" gap
    // above gets the admin override, never an explicit isAllowed: false row.
    throw new Error(`Transition from '${fromStatus}' to '${targetStatusKey}' is forbidden: ${rule[0].failureReason || "Rule restriction"}`);
  }

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
    actorId: actorId || null,
    note: note || `Status updated via Kanban to ${targetStatusKey}`,
  });

  // Log audit event
  await db.insert(auditLog).values({
    action: "kanbanStatusChange",
    entityType: "asset",
    entityId: asset.id,
    actorId: actorId || null,
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
