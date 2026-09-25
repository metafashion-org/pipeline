import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getLatestOfferForAsset, resendOfferForAsset } from "@/lib/offers/offer-service";
import { offerErrorResponse } from "@/lib/offers/offer-route-helpers";

export const dynamic = "force-dynamic";

async function findAssetId(sku: string): Promise<string | null> {
  const [row] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
  return row?.id ?? null;
}

// The asset's latest offer, for its drawer. Anyone who manages assignments or sees the whole board.
export async function GET(_request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists && !user.caps.canViewAllAssets) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const assetId = await findAssetId(skuId);
  if (!assetId) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  return NextResponse.json({ offer: await getLatestOfferForAsset(assetId) });
}

// Sends the current artist a fresh offer at the asset's current deadline and fee: for an artist
// who was assigned before offers existed and never heard about it, or one who hasn't answered.
export async function POST(_request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) {
    return NextResponse.json({ error: "You don't have permission to send offers" }, { status: 403 });
  }

  const assetId = await findAssetId(skuId);
  if (!assetId) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  try {
    const offer = await resendOfferForAsset(assetId, user.personnelId);
    return NextResponse.json({ offer });
  } catch (error) {
    return offerErrorResponse(error, "Failed to send the offer");
  }
}
