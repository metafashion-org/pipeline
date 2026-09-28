import { db } from "@/lib/db/client";
import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitionRules } from "@/lib/db/schema/status_transition_rules";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { brandGroups } from "@/lib/db/schema/brand_groups";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { assetOffers, type OfferStatus } from "@/lib/db/schema/asset_offers";
import { curationItemIdeas } from "@/lib/db/schema/curation_item_ideas";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import {
  TransitionRefusedError,
  artistRequired,
  assetNotFound,
  moveSwitchedOff,
  noSuchStep,
  notYourAsset,
  offerNotAccepted,
  paymentOrder,
  receiptRequired,
  roleNotAllowed,
  statusNotFound,
  type MoveContext,
  type TransitionErrorDetails,
} from "./transition-errors";
import { CURATED_STATUS, actorRoles, checkMove, type MoveRefusal, type MoveRule, type TransitionActor } from "./move-rules";

export type { TransitionActor } from "./move-rules";

export interface KanbanColumnData {
  key: string;
  label: string;
  sortOrder: number;
  description: string | null;
  whoCanMoveIn: string[] | null;
  nextActionHint: string | null;
  automationNote: string | null;
  assets: KanbanAssetCard[];
}

export interface KanbanLinkedArtifact {
  id: string;
  artifactId: string;
  title: string;
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
  // Used only to sort the board's artist filter (active people first) — not shown on the card itself.
  artistStatus: string | null;
  brandGroupId: string | null;
  brandGroupName: string | null;
  brandGroupUrl: string | null;
  // Registry artifacts linked to this asset, so the board's filter can answer "which assets came
  // out of this artifact" (e.g. a seasonal trend report) without a per-card network request.
  linkedArtifacts: KanbanLinkedArtifact[];
  // Full deep-link (https://discord.com/channels/{guild}/{channel}), built
  // server-side so the client never needs the guild id as a public env var.
  // Null when the artist hasn't been linked to a Discord channel yet — see
  // HANDOFF.md's Discord/personnel migration notes.
  artistDiscordUrl: string | null;
  gmailThreadId: string | null;
  deadline: Date | null;
  plannedUploadDate: Date | null;
  updatedAt: Date;
  // Raw JSONB straight from the assets table. Parse with parseDriveRefs (lib/assets/drive-links.ts) before rendering: one cell can hold several comma-joined Drive URLs, or free text that is not a link at all.
  referenceImages: unknown;
  recolorReferenceImages: unknown;
  // Status of the asset's latest offer to an artist (see lib/offers/offer-service.ts), or null when
  // it has never been offered. The card shows a badge while it's waiting on someone.
  offerStatus: OfferStatus | null;
  // Whether a payment receipt is attached. Payment Done needs one, so the card says so while it's missing.
  hasPaymentReceipt: boolean;
  // For a card in Curated: who curated it, and whether the team sent it back to them with a note.
  curatorId: string | null;
  curationSentBack: boolean;
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
export type KanbanAssetCardClient = Omit<KanbanAssetCard, "deadline" | "plannedUploadDate" | "updatedAt"> & {
  deadline: string | Date | null;
  plannedUploadDate: string | Date | null;
  updatedAt: string | Date;
};

/** A KanbanColumnData holding client-shaped cards. */
export type KanbanColumnDataClient = Omit<KanbanColumnData, "assets"> & { assets: KanbanAssetCardClient[] };

/**
 * Everything the board shows: one column per status with its cards, and every transition rule, so
 * the board can explain each column and check a move with the same checkMove the server uses.
 */
export async function getKanbanBoardData(
  artistEmail?: string,
  options: { showCurated?: boolean } = {}
): Promise<{ columns: KanbanColumnData[]; rules: MoveRule[] }> {
  // The Curated column only exists for people curation review is switched on for (see
  // lib/settings/app-settings.ts). For everyone else it and its cards are left out entirely: an
  // admin's test idea must not fall through into someone else's Unassigned column.
  const showCurated = options.showCurated ?? false;
  // The status config, the asset list, and the artist<->artifact link list are independent, so
  // they are fetched concurrently. Links are queried separately rather than joined onto the main
  // asset query because an asset can carry more than one link — a join would multiply its row
  // (and every other joined column, artist/brand group included) once per link.
  const [allStatuses, fetchedAssets, allLinks, latestOffers, allRules, curatedIdeas] = await Promise.all([
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
      artistStatus: personnel.status,
      artistDiscordChannelId: personnel.discordChannelId,
      brandGroupId: assets.brandGroupId,
      brandGroupName: brandGroups.name,
      brandGroupUrl: brandGroups.robloxGroupUrl,
      gmailThreadId: assets.gmailThreadId,
      deadline: assets.deadline,
      plannedUploadDate: assets.plannedUploadDate,
      updatedAt: assets.updatedAt,
      referenceImages: assets.referenceImages,
      recolorReferenceImages: assets.recolorReferenceImages,
      hasPaymentReceipt: sql<boolean>`${assets.paymentReceiptUrl} IS NOT NULL`,
    })
    .from(assets)
    .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
    .leftJoin(brandGroups, eq(assets.brandGroupId, brandGroups.id))
    // Filter in the query rather than after it. An artist's board read every asset in the
    // table and then discarded all but their own in JavaScript, on every page load. Compared
    // lowercase on both sides so this keeps the case-insensitive behaviour the filter had.
    .where(artistEmail ? sql`lower(${personnel.email}) = ${artistEmail.toLowerCase()}` : undefined),
    db
      .select({
        assetId: artifactSkuLinks.assetId,
        id: knowledgeArtifacts.id,
        artifactId: knowledgeArtifacts.artifactId,
        title: knowledgeArtifacts.title,
      })
      .from(artifactSkuLinks)
      .innerJoin(knowledgeArtifacts, eq(artifactSkuLinks.artifactId, knowledgeArtifacts.id)),
    // One row per asset: its newest offer.
    db
      .selectDistinctOn([assetOffers.assetId], { assetId: assetOffers.assetId, status: assetOffers.status })
      .from(assetOffers)
      .orderBy(assetOffers.assetId, desc(assetOffers.createdAt)),
    db
      .select({
        fromStatus: statusTransitionRules.fromStatus,
        toStatus: statusTransitionRules.toStatus,
        role: statusTransitionRules.role,
        isAllowed: statusTransitionRules.isAllowed,
        isAutomatic: statusTransitionRules.isAutomatic,
        triggerNote: statusTransitionRules.triggerNote,
        failureReason: statusTransitionRules.failureReason,
      })
      .from(statusTransitionRules),
    // The idea behind each card in Curated: who curated it, and whether it was sent back to them.
    showCurated
      ? db
          .select({ assetId: curationItemIdeas.assetId, submittedBy: curationItemIdeas.submittedBy, status: curationItemIdeas.status })
          .from(curationItemIdeas)
          .innerJoin(assets, eq(curationItemIdeas.assetId, assets.id))
          .where(eq(assets.currentStatus, CURATED_STATUS))
      : Promise.resolve([]),
  ]);

  const ideaByAsset = new Map(curatedIdeas.map((idea) => [idea.assetId, idea]));

  const offerStatusByAsset = new Map(latestOffers.map((offer) => [offer.assetId, offer.status]));

  const guildId = process.env.DISCORD_GUILD_ID;

  const linksByAsset = new Map<string, KanbanLinkedArtifact[]>();
  for (const link of allLinks) {
    const list = linksByAsset.get(link.assetId) ?? [];
    list.push({ id: link.id, artifactId: link.artifactId, title: link.title });
    linksByAsset.set(link.assetId, list);
  }

  // Maps the raw query row (which selected the artist's discordChannelId, an
  // internal id) into the public KanbanAssetCard shape (a full deep-link URL,
  // built here so the client never needs the guild id as a public env var).
  const allAssets: KanbanAssetCard[] = fetchedAssets.map(({ artistDiscordChannelId, ...rest }) => ({
    ...rest,
    curatorId: ideaByAsset.get(rest.id)?.submittedBy ?? null,
    // A sent-back idea is back in its curator's drafts while its card waits in Curated.
    curationSentBack: ideaByAsset.get(rest.id)?.status === "draft",
    artistDiscordUrl: artistDiscordChannelId && guildId ? `https://discord.com/channels/${guildId}/${artistDiscordChannelId}` : null,
    linkedArtifacts: linksByAsset.get(rest.id) ?? [],
    offerStatus: offerStatusByAsset.get(rest.id) ?? null,
  }));

  const columnsMap = new Map<string, KanbanColumnData>();

  for (const s of allStatuses) {
    if (s.key === CURATED_STATUS && !showCurated) continue;
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
    if (a.currentStatus === CURATED_STATUS && !showCurated) continue;
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
    rules: allRules,
  };
}

// Loads what a refusal needs to explain itself in plain words: the display label of every status,
// and the moves that leave the asset's current status. Called only once a move is already being
// refused, so a move that succeeds never pays for these two queries.
async function buildMoveContext(
  fromStatusKey: string,
  target: typeof statuses.$inferSelect,
  actor: TransitionActor | undefined
): Promise<MoveContext> {
  const [allStatuses, stepsFromCurrent] = await Promise.all([
    db.select().from(statuses),
    db.select().from(statusTransitionRules).where(eq(statusTransitionRules.fromStatus, fromStatusKey)),
  ]);
  // An asset can carry a status key with no statuses row (see the board's stale-status fallback),
  // so the label falls back to the raw key rather than failing while explaining a failure.
  const fromRow = allStatuses.find((s) => s.key === fromStatusKey);

  return {
    from: { key: fromStatusKey, label: fromRow?.label ?? fromStatusKey, sortOrder: fromRow?.sortOrder ?? 0 },
    to: { key: target.key, label: target.label, sortOrder: target.sortOrder },
    labels: new Map(allStatuses.map((s) => [s.key, s.label])),
    stepsFromCurrent: stepsFromCurrent.map((r) => ({
      toKey: r.toStatus,
      role: r.role,
      isAutomatic: r.isAutomatic,
      isAllowed: r.isAllowed,
    })),
    actorRoles: actorRoles(actor),
  };
}

// The words for each refusal kind. Built only once a move is refused, so a move that succeeds
// never pays for the queries behind the context.
function refusalDetails(refusal: MoveRefusal, ctx: MoveContext): TransitionErrorDetails {
  switch (refusal.kind) {
    case "not-your-asset":
      return notYourAsset();
    case "no-such-step":
      return noSuchStep(ctx);
    case "payment-order":
      return paymentOrder(ctx);
    case "switched-off":
      return moveSwitchedOff(ctx, refusal.failureReason);
    case "role":
      return roleNotAllowed(ctx, refusal.refusal);
    case "artist-required":
      return artistRequired(ctx);
    case "offer-open":
      return offerNotAccepted(ctx);
    case "receipt-required":
      return receiptRequired(ctx);
  }
}

export async function updateAssetStatusInKanban(
  sku: string,
  targetStatusKey: string,
  actor?: TransitionActor,
  note?: string
) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) {
    throw new TransitionRefusedError(assetNotFound());
  }

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  if (fromStatus === targetStatusKey) {
    return { success: true, sku, currentStatus: targetStatusKey, changed: false };
  }

  // Validate target status key exists
  const targetStatus = await db.select().from(statuses).where(eq(statuses.key, targetStatusKey)).limit(1);
  if (targetStatus.length === 0) {
    throw new TransitionRefusedError(statusNotFound(targetStatusKey));
  }

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

  // Only a card leaving Assigned needs its offer: an unanswered offer holds it there.
  const [latestOffer] =
    fromStatus === "assigned"
      ? await db
          .select({ status: assetOffers.status })
          .from(assetOffers)
          .where(eq(assetOffers.assetId, asset.id))
          .orderBy(desc(assetOffers.createdAt))
          .limit(1)
      : [];

  // Every check lives in checkMove (lib/kanban/move-rules.ts), which the board also runs to show
  // who can move each card, so what the board shows and what this enforces can't drift apart.
  const refusal = checkMove(
    actor,
    {
      currentStatus: fromStatus,
      artistId: asset.currentArtistId,
      offerStatus: latestOffer?.status ?? null,
      hasPaymentReceipt: Boolean(asset.paymentReceiptUrl),
    },
    targetStatus[0],
    rule[0]
  );
  if (refusal) {
    const ctx = await buildMoveContext(fromStatus, targetStatus[0], actor);
    throw new TransitionRefusedError(refusalDetails(refusal, ctx));
  }

  const actorPersonnelId = actor && !actor.system ? actor.personnelId ?? null : null;

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

  // Leaving Curated is the team's approval of the idea behind the card.
  if (fromStatus === CURATED_STATUS) {
    await db
      .update(curationItemIdeas)
      .set({ status: "approved", reviewNote: null, updatedAt: new Date() })
      .where(eq(curationItemIdeas.assetId, asset.id));
  }

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
