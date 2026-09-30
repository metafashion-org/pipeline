import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { notifyArtistOfStatusChange } from "@/lib/notifications/artist-status";
import { isArtistNotifiedStatus } from "@/lib/notifications/artist-notified-statuses";

export const dynamic = "force-dynamic";

/**
 * Sends the artist the notice for their card's current status again: the approval email and Discord
 * ping, or the revisions one. For when the card moved before these notices existed, or the artist
 * says they didn't get it.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) return NextResponse.json({ error: "Only the team can remind an artist" }, { status: 403 });

  const [asset] = await db
    .select({ id: assets.id, currentStatus: assets.currentStatus, currentArtistId: assets.currentArtistId })
    .from(assets)
    .where(eq(assets.sku, skuId))
    .limit(1);
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  if (!asset.currentArtistId) return NextResponse.json({ error: "This asset has no artist to remind" }, { status: 409 });
  if (!isArtistNotifiedStatus(asset.currentStatus)) {
    return NextResponse.json({ error: "Artists are only reminded about Approved and Revisions Requested cards" }, { status: 409 });
  }

  await notifyArtistOfStatusChange(skuId, asset.currentStatus);
  await db.insert(auditLog).values({
    action: "resendStatusNotice",
    entityType: "asset",
    entityId: asset.id,
    actorId: user.personnelId ?? null,
    payload: { sku: skuId, status: asset.currentStatus },
  });
  return NextResponse.json({ success: true });
}
