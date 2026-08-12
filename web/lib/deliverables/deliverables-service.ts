import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";

export async function submitFinalDeliverables(
  sku: string,
  fileUrls: string[],
  submitterId?: string,
  notes?: string
) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  // Append new reference files
  const existingRefs = (asset.referenceImages as any[]) || [];
  const newRefs = fileUrls.map((url) => ({ provider: "filestore", externalId: url }));
  const updatedRefs = [...existingRefs, ...newRefs];

  await db
    .update(assets)
    .set({
      currentStatus: "final_files_received",
      referenceImages: updatedRefs,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, asset.id));

  await db.insert(statusHistory).values({
    assetId: asset.id,
    fromStatus,
    toStatus: "final_files_received",
    actorId: submitterId || null,
    note: notes || "Final 3D asset files submitted",
  });

  await db.insert(auditLog).values({
    action: "submitFinalDeliverables",
    entityType: "asset",
    entityId: asset.id,
    actorId: submitterId || null,
    payload: { sku, fileUrls },
  });

  return { success: true, sku, currentStatus: "final_files_received" };
}

export async function markAssetForPayment(sku: string, actorId?: string, notes?: string) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  // 🔒 STRICT PAYMENT GATE ENFORCEMENT: Only assets in 'uploaded_to_roblox' can be marked for payment
  if (fromStatus !== "uploaded_to_roblox") {
    throw new Error(
      `Payment gate restriction: Assets can only be marked for payment after being uploaded to Roblox (current status: '${fromStatus}')`
    );
  }

  await db
    .update(assets)
    .set({
      currentStatus: "marked_for_payment",
      updatedAt: new Date(),
    })
    .where(eq(assets.id, asset.id));

  await db.insert(statusHistory).values({
    assetId: asset.id,
    fromStatus,
    toStatus: "marked_for_payment",
    actorId: actorId || null,
    note: notes || "Marked for payment after Roblox upload",
  });

  await db.insert(auditLog).values({
    action: "markForPayment",
    entityType: "asset",
    entityId: asset.id,
    actorId: actorId || null,
    payload: { sku, fromStatus },
  });

  return { success: true, sku, currentStatus: "marked_for_payment" };
}
