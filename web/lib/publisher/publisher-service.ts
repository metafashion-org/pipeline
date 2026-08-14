import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";

export interface RecordRobloxUploadOptions {
  sku: string;
  publisherId?: string;
  robloxItemUrl: string;
  robloxAssetId?: string;
  uploadNotes?: string;
}

export async function recordRobloxUpload(options: RecordRobloxUploadOptions) {
  const { sku, publisherId, robloxItemUrl, robloxAssetId, uploadNotes } = options;

  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  // 1. Insert upload record
  const [record] = await db
    .insert(uploadRecords)
    .values({
      assetId: asset.id,
      publisherId: publisherId || null,
      robloxAssetId: robloxAssetId || null,
      robloxItemUrl,
      uploadNotes: uploadNotes || "Published to Roblox Marketplace",
    })
    .returning();

  // 2. Transition status to 'uploaded_to_roblox'
  await db
    .update(assets)
    .set({
      currentStatus: "uploaded_to_roblox",
      updatedAt: new Date(),
    })
    .where(eq(assets.id, asset.id));

  // 3. Log status history
  await db.insert(statusHistory).values({
    assetId: asset.id,
    fromStatus,
    toStatus: "uploaded_to_roblox",
    actorId: publisherId || null,
    note: `Roblox upload link submitted: ${robloxItemUrl}`,
  });

  // 4. Log audit trail
  await db.insert(auditLog).values({
    action: "robloxMarketplaceUpload",
    entityType: "asset",
    entityId: asset.id,
    actorId: publisherId || null,
    payload: { sku, uploadRecordId: record.id, robloxItemUrl },
  });

  return {
    uploadRecordId: record.id,
    sku,
    currentStatus: "uploaded_to_roblox",
  };
}
