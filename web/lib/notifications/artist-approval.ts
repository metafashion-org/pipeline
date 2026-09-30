import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { eq } from "drizzle-orm";
import { parseDriveRefs, driveThumbnailUrl } from "@/lib/assets/drive-links";
import { EMAIL_IMAGE_WIDTH_PX } from "@/lib/email/templates/email-layout";
import { notifyArtistOfApproval } from "@/lib/offers/offer-notifications";

/**
 * Tells an asset's artist that the team approved it, by email and on Discord, with a link that
 * opens Submit final files with the asset picked. Called when a card moves to Approved.
 *
 * Input: the asset's SKU. Output: nothing. Never throws: a notification problem must not undo the
 * move to Approved. An asset with no artist, or one whose artist is no longer Active, sends nothing.
 */
export async function notifyArtistAssetApproved(sku: string): Promise<void> {
  try {
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
    if (!row || row.artistStatus !== "Active") return;

    const firstImage = parseDriveRefs(row.referenceImages).find((ref) => ref.fileId);
    await notifyArtistOfApproval({
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
    });
  } catch (error) {
    console.error("[approval] artist notification failed:", error);
  }
}
