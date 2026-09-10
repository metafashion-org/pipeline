import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, asc } from "drizzle-orm";
import { parseRobloxLinkLines } from "./roblox-links";

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
  /** One Roblox catalog link per entry. Validated per entry; the catalog id is read out of each link rather than typed separately. */
  robloxItemUrls: string[];
  uploadNotes?: string;
}

export interface RecordRobloxUploadResult {
  uploadRecordIds: string[];
  sku: string;
  currentStatus: string;
  links: { url: string; assetId: string }[];
}

export async function recordRobloxUpload(options: RecordRobloxUploadOptions): Promise<RecordRobloxUploadResult> {
  const { sku, publisherId, robloxItemUrls, uploadNotes } = options;

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
      payload: { sku, reason: `Asset not Ready for Upload (currently: ${fromStatus})`, robloxItemUrls },
    });
    throw new Error(
      `Rejected: '${sku}' must be Ready for Upload before a Roblox link can be recorded (currently: ${fromStatus}).`
    );
  }

  // Validated here as well as at the API route and in the browser, because this is the last point before the links are written and the status moves. A bad line must stop the whole submission rather than record the good ones and leave the uploader to work out which of their links went in.
  const { valid, invalid } = parseRobloxLinkLines(robloxItemUrls);
  if (invalid.length > 0) {
    throw new Error(
      `Rejected: ${invalid.length} line${invalid.length === 1 ? "" : "s"} ${invalid.length === 1 ? "is" : "are"} not a valid Roblox catalog link — ` +
        invalid.map((i) => `line ${i.line}: ${i.reason}`).join("; ")
    );
  }
  if (valid.length === 0) {
    throw new Error("Rejected: at least one Roblox item URL is required.");
  }

  // 1. Insert one upload record per link
  const records = await db
    .insert(uploadRecords)
    .values(
      valid.map((link) => ({
        assetId: asset.id,
        publisherId: publisherId || null,
        robloxAssetId: link.assetId,
        robloxItemUrl: link.url,
        uploadNotes: uploadNotes || "Published to Roblox Marketplace",
      }))
    )
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
    note: `Roblox upload link${valid.length === 1 ? "" : "s"} submitted: ${valid.map((l) => l.url).join(", ")}`,
  });

  // 4. Log audit trail
  await db.insert(auditLog).values({
    action: "robloxMarketplaceUpload",
    entityType: "asset",
    entityId: asset.id,
    actorId: publisherId || null,
    payload: { sku, uploadRecordIds: records.map((r) => r.id), robloxItemUrls: valid.map((l) => l.url) },
  });

  return {
    uploadRecordIds: records.map((r) => r.id),
    sku,
    currentStatus: "uploaded_to_roblox",
    links: valid.map((l) => ({ url: l.url, assetId: l.assetId })),
  };
}
