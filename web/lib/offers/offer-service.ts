import { db } from "@/lib/db/client";
import { assetOffers, OPEN_OFFER_STATUSES, type OfferStatus } from "@/lib/db/schema/asset_offers";
import { assets } from "@/lib/db/schema/assets";
import { assignments } from "@/lib/db/schema/assignments";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { and, desc, eq, inArray } from "drizzle-orm";
import { parseDriveRefs, driveThumbnailUrl } from "@/lib/assets/drive-links";
import { updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import { sendAssignmentBrief } from "@/lib/kanban/assignment-brief";
import { MAX_DEADLINE_EXTENSION_DAYS } from "./offer-rules";
import { EMAIL_IMAGE_WIDTH_PX } from "@/lib/email/templates/email-layout";
import {
  notifyArtistOfExtensionDecision,
  notifyArtistOfOffer,
  notifyTeamOfDecline,
  notifyTeamOfExtensionRequest,
  type OfferSummary,
} from "./offer-notifications";

const DAY_MS = 24 * 60 * 60 * 1000;

// Statuses where the asset is still waiting to be made, so a decline sends it back to Unassigned.
// Past these, a declined reassignment only clears the artist and leaves the status alone.
const RETURN_TO_UNASSIGNED_ON_DECLINE = ["assigned", "in_progress", "revisions_requested", "in_review"];

/** An offer action refused for a reason the caller can show as it is. `httpStatus` is what a route answers with. */
export class OfferActionError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "OfferActionError";
    this.httpStatus = httpStatus;
  }
}

async function loadOffer(offerId: string) {
  const [offer] = await db.select().from(assetOffers).where(eq(assetOffers.id, offerId)).limit(1);
  if (!offer) throw new OfferActionError("That offer doesn't exist.", 404);
  return offer;
}

// The artist acting on an offer has to be the artist it was made to.
function assertOfferIsFor(offer: typeof assetOffers.$inferSelect, artistId: string | undefined) {
  if (!artistId || offer.artistId !== artistId) {
    throw new OfferActionError("This offer was made to someone else.", 403);
  }
}

function assertStatus(offer: typeof assetOffers.$inferSelect, allowed: OfferStatus[], action: string) {
  if (!allowed.includes(offer.status)) {
    throw new OfferActionError(`You can't ${action}: this offer is ${offer.status.replace("_", " ")}.`, 409);
  }
}

/**
 * Loads what every notification about an offer shows: the asset, its first reference image, what
 * was offered, and the artist's email and Discord channel.
 */
async function loadOfferSummary(offer: typeof assetOffers.$inferSelect): Promise<OfferSummary> {
  const [row] = await db
    .select({
      sku: assets.sku,
      itemName: assets.itemName,
      category: assets.category,
      referenceImages: assets.referenceImages,
      artistName: personnel.name,
      artistEmail: personnel.email,
      artistDiscordUserId: personnel.discordUserId,
      artistDiscordChannelId: personnel.discordChannelId,
    })
    .from(assets)
    .innerJoin(personnel, eq(personnel.id, offer.artistId))
    .where(eq(assets.id, offer.assetId))
    .limit(1);
  if (!row) throw new OfferActionError("The asset for this offer no longer exists.", 404);

  const firstImage = parseDriveRefs(row.referenceImages).find((ref) => ref.fileId);
  return {
    offerId: offer.id,
    assetId: offer.assetId,
    sku: row.sku,
    itemName: row.itemName,
    category: row.category,
    imageUrl: firstImage?.fileId ? driveThumbnailUrl(firstImage.fileId, EMAIL_IMAGE_WIDTH_PX) : null,
    feeAmount: offer.feeAmount,
    currency: offer.currency,
    offeredDeadline: offer.offeredDeadline,
    artistName: row.artistName,
    artistEmail: row.artistEmail,
    artistDiscordUserId: row.artistDiscordUserId,
    artistDiscordChannelId: row.artistDiscordChannelId,
  };
}

// Writes the agreed deadline everywhere the rest of the app reads a deadline from: the asset (the
// board, the calendar, the uploader queue) and the assignment.
async function applyAgreedDeadline(offer: typeof assetOffers.$inferSelect, agreedDeadline: Date) {
  await db.update(assets).set({ deadline: agreedDeadline, updatedAt: new Date() }).where(eq(assets.id, offer.assetId));
  if (offer.assignmentId) {
    await db.update(assignments).set({ deadline: agreedDeadline }).where(eq(assignments.id, offer.assignmentId));
  }
}

async function writeAudit(action: string, offer: typeof assetOffers.$inferSelect, actorId: string | undefined, payload: object) {
  await db.insert(auditLog).values({
    action,
    entityType: "asset",
    entityId: offer.assetId,
    actorId: actorId || null,
    payload: { offerId: offer.id, ...payload },
  });
}

export interface CreateOfferOptions {
  assetId: string;
  assignmentId: string | null;
  artistId: string;
  deadline: Date;
  feeAmount: string | null;
  currency: string | null;
  createdBy?: string;
}

/**
 * Offers an asset to an artist and tells them by email and in their Discord channel.
 *
 * Input: the asset, its assignment, the artist, and the deadline and fee being offered.
 * Output: the new offer row. Any offer still open on the same asset is withdrawn first, so an
 * asset only ever has one offer waiting on an answer.
 */
export async function createOfferAndNotifyArtist(options: CreateOfferOptions) {
  await db
    .update(assetOffers)
    .set({ status: "withdrawn", updatedAt: new Date() })
    .where(and(eq(assetOffers.assetId, options.assetId), inArray(assetOffers.status, OPEN_OFFER_STATUSES)));

  const [offer] = await db
    .insert(assetOffers)
    .values({
      assetId: options.assetId,
      assignmentId: options.assignmentId,
      artistId: options.artistId,
      offeredDeadline: options.deadline,
      feeAmount: options.feeAmount,
      currency: options.currency,
      createdBy: options.createdBy || null,
    })
    .returning();

  await writeAudit("offerSent", offer, options.createdBy, { artistId: options.artistId, deadline: options.deadline });
  await notifyArtistOfOffer(await loadOfferSummary(offer));
  return offer;
}

/**
 * The artist accepts the offer at the offered deadline. The full brief goes out by email now that
 * the asset is theirs.
 */
export async function acceptOffer(offerId: string, artistId: string | undefined) {
  const offer = await loadOffer(offerId);
  assertOfferIsFor(offer, artistId);
  assertStatus(offer, ["pending"], "accept it");

  const [updated] = await db
    .update(assetOffers)
    .set({ status: "accepted", agreedDeadline: offer.offeredDeadline, respondedAt: new Date(), updatedAt: new Date() })
    .where(eq(assetOffers.id, offer.id))
    .returning();
  await applyAgreedDeadline(offer, offer.offeredDeadline);
  await writeAudit("offerAccepted", offer, artistId, { agreedDeadline: offer.offeredDeadline });
  await sendAssignmentBrief(offer.assetId, offer.artistId, offer.assignmentId);
  return updated;
}

/**
 * The artist asks for a later deadline, up to MAX_DEADLINE_EXTENSION_DAYS past the offered one.
 * Nothing is agreed until the team approves it; the team is emailed now.
 *
 * Input: the offer, the artist, the requested date, and an optional reason.
 */
export async function requestDeadlineExtension(
  offerId: string,
  artistId: string | undefined,
  requestedDeadline: Date,
  reason: string | null
) {
  const offer = await loadOffer(offerId);
  assertOfferIsFor(offer, artistId);
  assertStatus(offer, ["pending"], "ask for a new deadline");

  const extraDays = Math.round((requestedDeadline.getTime() - offer.offeredDeadline.getTime()) / DAY_MS);
  if (extraDays < 1 || extraDays > MAX_DEADLINE_EXTENSION_DAYS) {
    throw new OfferActionError(
      `Pick a date 1 to ${MAX_DEADLINE_EXTENSION_DAYS} days after the offered deadline.`,
      400
    );
  }

  const [updated] = await db
    .update(assetOffers)
    .set({
      status: "extension_requested",
      requestedDeadline,
      extensionReason: reason,
      extensionDecision: null,
      extensionDecidedAt: null,
      extensionDecidedBy: null,
      respondedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(assetOffers.id, offer.id))
    .returning();
  await writeAudit("offerExtensionRequested", offer, artistId, { requestedDeadline, reason });
  await notifyTeamOfExtensionRequest(await loadOfferSummary(offer), requestedDeadline, reason);
  return updated;
}

/** The team approves a requested deadline. The offer is accepted at that date and the artist is told. */
export async function approveDeadlineExtension(offerId: string, deciderId: string | undefined) {
  const offer = await loadOffer(offerId);
  assertStatus(offer, ["extension_requested"], "approve a deadline");
  const agreedDeadline = offer.requestedDeadline as Date;

  const [updated] = await db
    .update(assetOffers)
    .set({
      status: "accepted",
      agreedDeadline,
      extensionDecision: "approved",
      extensionDecidedAt: new Date(),
      extensionDecidedBy: deciderId || null,
      updatedAt: new Date(),
    })
    .where(eq(assetOffers.id, offer.id))
    .returning();
  await applyAgreedDeadline(offer, agreedDeadline);
  await writeAudit("offerExtensionApproved", offer, deciderId, { agreedDeadline });
  await notifyArtistOfExtensionDecision(await loadOfferSummary(offer), true, agreedDeadline);
  await sendAssignmentBrief(offer.assetId, offer.artistId, offer.assignmentId);
  return updated;
}

/**
 * The team rejects a requested deadline. The offer goes back to waiting on the artist at the
 * original deadline, and the artist is told they can accept that or decline.
 */
export async function rejectDeadlineExtension(offerId: string, deciderId: string | undefined) {
  const offer = await loadOffer(offerId);
  assertStatus(offer, ["extension_requested"], "reject a deadline");

  const [updated] = await db
    .update(assetOffers)
    .set({
      status: "pending",
      extensionDecision: "rejected",
      extensionDecidedAt: new Date(),
      extensionDecidedBy: deciderId || null,
      updatedAt: new Date(),
    })
    .where(eq(assetOffers.id, offer.id))
    .returning();
  await writeAudit("offerExtensionRejected", offer, deciderId, { requestedDeadline: offer.requestedDeadline });
  await notifyArtistOfExtensionDecision(await loadOfferSummary(offer), false, null);
  return updated;
}

/**
 * The artist declines, optionally saying why. Their assignment ends, the asset goes back to
 * Unassigned, and the team is emailed the reason.
 */
export async function declineOffer(offerId: string, artistId: string | undefined, reason: string | null) {
  const offer = await loadOffer(offerId);
  assertOfferIsFor(offer, artistId);
  assertStatus(offer, ["pending", "extension_requested"], "decline it");

  const [updated] = await db
    .update(assetOffers)
    .set({ status: "declined", declineReason: reason, respondedAt: new Date(), updatedAt: new Date() })
    .where(eq(assetOffers.id, offer.id))
    .returning();

  if (offer.assignmentId) {
    await db
      .update(assignments)
      .set({ isActive: false, unassignedAt: new Date(), unassignedReason: "Declined by artist" })
      .where(eq(assignments.id, offer.assignmentId));
  }

  const [asset] = await db.select().from(assets).where(eq(assets.id, offer.assetId)).limit(1);
  if (asset && asset.currentArtistId === offer.artistId) {
    await db.update(assets).set({ currentArtistId: null, updatedAt: new Date() }).where(eq(assets.id, asset.id));
    if (RETURN_TO_UNASSIGNED_ON_DECLINE.includes(asset.currentStatus)) {
      await updateAssetStatusInKanban(asset.sku, "unassigned", { system: true }, "Offer declined by the artist");
    }
  }

  await writeAudit("offerDeclined", offer, artistId, { reason });
  await notifyTeamOfDecline(await loadOfferSummary(offer), reason);
  return updated;
}

/**
 * Sends a fresh offer for the asset's current assignment, for an asset whose artist was never
 * told, or whose offer went unanswered. Uses the asset's current deadline and fee.
 */
export async function resendOfferForAsset(assetId: string, createdBy: string | undefined) {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) throw new OfferActionError("That asset doesn't exist.", 404);
  if (!asset.currentArtistId) throw new OfferActionError("Assign an artist before sending an offer.", 400);
  if (!asset.deadline) throw new OfferActionError("Set a deadline on the asset before sending an offer.", 400);

  const [assignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.assetId, asset.id), eq(assignments.isActive, true)))
    .orderBy(desc(assignments.assignedAt))
    .limit(1);

  return createOfferAndNotifyArtist({
    assetId: asset.id,
    assignmentId: assignment?.id ?? null,
    artistId: asset.currentArtistId,
    deadline: asset.deadline,
    feeAmount: asset.feeAmount,
    currency: asset.currency,
    createdBy,
  });
}

/** What the artist sees for one offer on My Tasks. */
export interface ArtistOfferView {
  id: string;
  status: OfferStatus;
  sku: string;
  itemName: string;
  category: string | null;
  /** Drive file id of the asset's first reference image, rendered with DriveImage; null when it has none. */
  imageFileId: string | null;
  feeAmount: string | null;
  currency: string | null;
  offeredDeadline: Date;
  requestedDeadline: Date | null;
  extensionDecision: string | null;
  createdAt: Date;
}

/** The artist's offers that still need an answer from them or a decision from the team, newest first. */
export async function getOpenOffersForArtist(artistId: string): Promise<ArtistOfferView[]> {
  const rows = await db
    .select({
      id: assetOffers.id,
      status: assetOffers.status,
      sku: assets.sku,
      itemName: assets.itemName,
      category: assets.category,
      referenceImages: assets.referenceImages,
      feeAmount: assetOffers.feeAmount,
      currency: assetOffers.currency,
      offeredDeadline: assetOffers.offeredDeadline,
      requestedDeadline: assetOffers.requestedDeadline,
      extensionDecision: assetOffers.extensionDecision,
      createdAt: assetOffers.createdAt,
    })
    .from(assetOffers)
    .innerJoin(assets, eq(assets.id, assetOffers.assetId))
    .where(and(eq(assetOffers.artistId, artistId), inArray(assetOffers.status, OPEN_OFFER_STATUSES)))
    .orderBy(desc(assetOffers.createdAt));

  return rows.map(({ referenceImages, ...row }) => {
    const firstImage = parseDriveRefs(referenceImages).find((ref) => ref.fileId);
    return { ...row, imageFileId: firstImage?.fileId ?? null };
  });
}

/** What the team sees about an asset's latest offer in its drawer. */
export interface AssetOfferView {
  id: string;
  status: OfferStatus;
  artistName: string;
  offeredDeadline: Date;
  requestedDeadline: Date | null;
  extensionReason: string | null;
  extensionDecision: string | null;
  agreedDeadline: Date | null;
  declineReason: string | null;
  respondedAt: Date | null;
  createdAt: Date;
}

/** The asset's most recent offer, or null when it has never had one. */
export async function getLatestOfferForAsset(assetId: string): Promise<AssetOfferView | null> {
  const [row] = await db
    .select({
      id: assetOffers.id,
      status: assetOffers.status,
      artistName: personnel.name,
      offeredDeadline: assetOffers.offeredDeadline,
      requestedDeadline: assetOffers.requestedDeadline,
      extensionReason: assetOffers.extensionReason,
      extensionDecision: assetOffers.extensionDecision,
      agreedDeadline: assetOffers.agreedDeadline,
      declineReason: assetOffers.declineReason,
      respondedAt: assetOffers.respondedAt,
      createdAt: assetOffers.createdAt,
    })
    .from(assetOffers)
    .innerJoin(personnel, eq(personnel.id, assetOffers.artistId))
    .where(eq(assetOffers.assetId, assetId))
    .orderBy(desc(assetOffers.createdAt))
    .limit(1);
  return row ?? null;
}
