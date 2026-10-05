import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { canAddAssets, getEffectiveCapabilities } from "@/lib/auth/rbac";
import { assetSignoffs } from "@/lib/db/schema/asset_signoffs";
import { SIGNOFF_STATUS } from "@/lib/signoff/signoff-rules";
import { UpdateAssetSchema, computeAssetChanges } from "@/lib/assets/asset-update";
import { eq } from "drizzle-orm";

// Whether this asset is waiting for sign-off and was added by this person.
async function isOwnAssetAwaitingSignoff(sku: string, personnelId: string | undefined): Promise<boolean> {
  if (!personnelId) return false;
  const [row] = await db
    .select({ status: assets.currentStatus, submittedBy: assetSignoffs.submittedBy })
    .from(assets)
    .innerJoin(assetSignoffs, eq(assetSignoffs.assetId, assets.id))
    .where(eq(assets.sku, sku))
    .limit(1);
  return row?.status === SIGNOFF_STATUS && row.submittedBy === personnelId;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ skuId: string }> }
) {
  const [session, { skuId }] = await Promise.all([getServerSession(authOptions), params]);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {});
  // The team edits any asset. A curator can edit only an asset they added that is still waiting for
  // Arjun's sign-off, so they can fix what he sent back; once it's on the board it's the team's.
  if (!caps.canAssignArtists && !(canAddAssets(caps) && (await isOwnAssetAwaitingSignoff(skuId, session.user.personnelId)))) {
    return NextResponse.json({ error: "You don't have permission to edit assets" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = UpdateAssetSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const { itemName, category, feeAmount, currency, brandGroupId, deadline, paymentReceiptUrl } = parseResult.data;
  if (
    itemName === undefined &&
    category === undefined &&
    feeAmount === undefined &&
    currency === undefined &&
    brandGroupId === undefined &&
    deadline === undefined &&
    parseResult.data.plannedUploadDate === undefined &&
    paymentReceiptUrl === undefined &&
    parseResult.data.referenceImages === undefined &&
    parseResult.data.recolorReferenceImages === undefined
  ) {
    return NextResponse.json({ error: "At least one field is required" }, { status: 400 });
  }

  const existing = await db.select().from(assets).where(eq(assets.sku, skuId)).limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: `Asset with SKU '${skuId}' not found` }, { status: 404 });
  }

  const current = existing[0];
  const { changes, updates } = computeAssetChanges(
    {
      itemName: current.itemName,
      category: current.category,
      feeAmount: current.feeAmount,
      currency: current.currency,
      brandGroupId: current.brandGroupId,
      deadline: current.deadline,
      plannedUploadDate: current.plannedUploadDate,
      paymentReceiptUrl: current.paymentReceiptUrl,
      referenceImages: current.referenceImages,
      recolorReferenceImages: current.recolorReferenceImages,
    },
    parseResult.data
  );

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: true, asset: current, changed: false });
  }

  const [updated] = await db
    .update(assets)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(assets.id, current.id))
    .returning();

  await db.insert(auditLog).values({
    action: "updateAsset",
    entityType: "asset",
    entityId: current.id,
    actorId: session.user.personnelId || null,
    payload: { sku: skuId, changes },
  });

  return NextResponse.json({ success: true, asset: updated });
}
