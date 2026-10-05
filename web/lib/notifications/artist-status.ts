import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { eq } from "drizzle-orm";
import { parseDriveRefs, driveThumbnailUrl } from "@/lib/assets/drive-links";
import { EMAIL_IMAGE_WIDTH_PX } from "@/lib/email/templates/email-layout";
import { notifyArtistOfApproval, notifyArtistOfRevisions, type OfferSummary } from "@/lib/offers/offer-notifications";
import type { ArtistNotifiedStatus } from "./artist-notified-statuses";

/** The asset and its artist, in the shape the notification emails and Discord messages take. Null with no Active artist. */
export async function loadArtistSummary(sku: string): Promise<OfferSummary | null> {
  const [row] = await db
    .select({
      assetId: assets.id,
      sku: assets.sku,
      itemName: assets.itemName,
      category: assets.category,
      referenceImages: assets.referenceImages,
      feeAmount: assets.feeAmount,
      currency: assets.currency,
      deadline: assets.deadline,
      artistId: personnel.id,
      artistName: personnel.name,
      artistEmail: personnel.email,
      artistStatus: personnel.status,
      artistDiscordUserId: personnel.discordUserId,
      artistDiscordChannelId: personnel.discordChannelId,
    })
    .from(assets)
    .innerJoin(personnel, eq(personnel.id, assets.currentArtistId))
    .where(eq(assets.sku, sku))
    .limit(1);
  if (!row || row.artistStatus !== "Active") return null;

  const firstImage = parseDriveRefs(row.referenceImages).find((ref) => ref.fileId);
  return {
    offerId: null,
    assetId: row.assetId,
    sku: row.sku,
    itemName: row.itemName,
    category: row.category,
    imageUrl: firstImage?.fileId ? driveThumbnailUrl(firstImage.fileId, EMAIL_IMAGE_WIDTH_PX) : null,
    feeAmount: row.feeAmount,
    currency: row.currency,
    offeredDeadline: row.deadline,
    artistId: row.artistId,
    offeredById: null,
    artistName: row.artistName,
    artistEmail: row.artistEmail,
    artistDiscordUserId: row.artistDiscordUserId,
    artistDiscordChannelId: row.artistDiscordChannelId,
  };
}

/**
 * Tells an asset's artist, by email and on Discord, that their card moved to Approved (with a link
 * to hand in the final files) or to Revisions Requested (with what to do once the changes are made).
 *
 * Input: the asset's SKU and the status it moved to. Output: nothing. Never throws: a notification
 * problem must not undo the move. An asset with no artist, or whose artist is no longer Active,
 * sends nothing.
 */
export async function notifyArtistOfStatusChange(sku: string, status: ArtistNotifiedStatus): Promise<void> {
  try {
    const summary = await loadArtistSummary(sku);
    if (!summary) return;
    if (status === "approved") await notifyArtistOfApproval(summary);
    else await notifyArtistOfRevisions(summary);
  } catch (error) {
    console.error(`[status notice] artist notification for ${status} failed:`, error);
  }
}
