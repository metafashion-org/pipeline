import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, asc } from "drizzle-orm";

export interface ReadyForUploadItem {
  id: string;
  sku: string;
  itemName: string;
  category: string | null;
  deadline: Date | null;
  artistName: string | null;
  updatedAt: Date;
}

// The brief's §9 shared Uploader queue — "any Uploader/Publisher-role person
// can see and act on" (see notifyUploader's design note in
// deliverables-service.ts). No route or query for this existed anywhere;
// the /publisher page needs it to show what's actually waiting.
export async function getReadyForUploadQueue(): Promise<ReadyForUploadItem[]> {
  const rows = await db
    .select({
      id: assets.id,
      sku: assets.sku,
      itemName: assets.itemName,
      category: assets.category,
      deadline: assets.deadline,
      artistName: personnel.name,
      updatedAt: assets.updatedAt,
    })
    .from(assets)
    .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
    .where(eq(assets.currentStatus, "ready_for_upload"))
    .orderBy(asc(assets.updatedAt));

  return rows;
}

export interface RecordRobloxUploadOptions {
  sku: string;
  publisherId?: string;
  robloxItemUrl: string;
  robloxAssetId?: string;
  uploadNotes?: string;
}

// Per the brief's §9: "Uploader receives work only after final files are
// accepted." No status check existed here before — this would happily
// record a Roblox upload (and jump the asset straight to
// Uploaded to Roblox) for an asset that was never even approved, skipping
// Ready for Upload entirely. Gated to ready_for_upload now, matching the
// real Kanban status list.
export async function recordRobloxUpload(options: RecordRobloxUploadOptions) {
  const { sku, publisherId, robloxItemUrl, robloxAssetId, uploadNotes } = options;

  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  if (fromStatus !== "ready_for_upload") {
    await db.insert(auditLog).values({
      action: "recordRobloxUpload_rejected",
      entityType: "asset",
      entityId: asset.id,
      actorId: publisherId || null,
      payload: { sku, reason: `Asset not Ready for Upload (currently: ${fromStatus})`, robloxItemUrl },
    });
    throw new Error(
      `Rejected: '${sku}' must be Ready for Upload before a Roblox link can be recorded (currently: ${fromStatus}).`
    );
  }

  if (!robloxItemUrl?.trim()) {
    throw new Error("Rejected: a Roblox item URL is required.");
  }

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
