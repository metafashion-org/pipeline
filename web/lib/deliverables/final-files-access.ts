import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import type { AuthedUser } from "@/lib/auth/authed-user";

/** The asset a final-files request is about, with what the access checks need. */
export async function findAssetForFinalFiles(sku: string) {
  const [asset] = await db
    .select({ id: assets.id, sku: assets.sku, currentStatus: assets.currentStatus, currentArtistId: assets.currentArtistId })
    .from(assets)
    .where(eq(assets.sku, sku))
    .limit(1);
  return asset ?? null;
}

function isAssignedArtist(user: AuthedUser, asset: { currentArtistId: string | null }): boolean {
  return Boolean(user.personnelId) && user.personnelId === asset.currentArtistId;
}

/** Who may hand in final files: the asset's own artist, or someone who manages assignments, on their behalf. */
export function canSubmitFinalFiles(user: AuthedUser, asset: { currentArtistId: string | null }): boolean {
  return user.caps.canAssignArtists || isAssignedArtist(user, asset);
}

/** Who may see an asset's final files: its artist, anyone who sees the whole board, and the uploader. */
export function canViewFinalFiles(user: AuthedUser, asset: { currentArtistId: string | null }): boolean {
  return user.caps.canViewAllAssets || user.caps.canPublishToRoblox || isAssignedArtist(user, asset);
}
