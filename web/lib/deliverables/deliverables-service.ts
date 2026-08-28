import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";

// Per the brief's §8: "The system validates that the SKU exists, is in
// Approved status, and required files are present. If valid, the record is
// stored... If invalid, the submission is rejected and the manager is
// notified." This function had none of that validation before — it would
// accept files and advance ANY asset regardless of current status. Fixed:
// real status check, real "at least one file" check. "Manager notified" on
// rejection means an audit log entry for now, same as every other
// notification in this codebase until real email sending exists (see
// HANDOFF.md) — not silently dropped, just not an email yet.
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

  if (fromStatus !== "approved") {
    await db.insert(auditLog).values({
      action: "submitFinalDeliverables_rejected",
      entityType: "asset",
      entityId: asset.id,
      actorId: submitterId || null,
      payload: { sku, reason: `Asset not in Approved status (currently: ${fromStatus})`, fileUrls },
    });
    throw new Error(
      `Submission rejected: '${sku}' must be in Approved status to accept final files (currently: ${fromStatus}).`
    );
  }

  const validFileUrls = fileUrls.map((u) => u.trim()).filter(Boolean);
  if (validFileUrls.length === 0) {
    await db.insert(auditLog).values({
      action: "submitFinalDeliverables_rejected",
      entityType: "asset",
      entityId: asset.id,
      actorId: submitterId || null,
      payload: { sku, reason: "No files provided" },
    });
    throw new Error("Submission rejected: at least one final file is required.");
  }

  // Append new reference files
  const existingRefs = (asset.referenceImages as any[]) || [];
  const newRefs = validFileUrls.map((url) => ({ provider: "filestore", externalId: url }));
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

// "Notify uploader" is a real card action in the brief's §5 and a real
// automatic-transition trigger in §5 ("Uploader notified → Ready for
// Upload") — didn't exist anywhere in the codebase before this. The brief
// doesn't describe a per-person uploader assignment the way artists get
// assigned (§9 just says the uploader "receives SKU, item name, final
// folder, upload instructions" once notified) — so this puts the asset into
// a shared Ready for Upload queue any Uploader/Publisher-role person can
// see and act on, rather than inventing a second assignment system the
// brief never asked for.
export async function notifyUploader(sku: string, actorId?: string, notes?: string) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  if (fromStatus !== "final_files_received") {
    throw new Error(
      `Cannot notify the uploader: '${sku}' must have final files received first (currently: ${fromStatus}).`
    );
  }

  await db
    .update(assets)
    .set({ currentStatus: "ready_for_upload", updatedAt: new Date() })
    .where(eq(assets.id, asset.id));

  await db.insert(statusHistory).values({
    assetId: asset.id,
    fromStatus,
    toStatus: "ready_for_upload",
    actorId: actorId || null,
    note: notes || "Uploader notified — final files, folder, and upload instructions ready",
  });

  await db.insert(auditLog).values({
    action: "notifyUploader",
    entityType: "asset",
    entityId: asset.id,
    actorId: actorId || null,
    payload: { sku },
  });

  return { success: true, sku, currentStatus: "ready_for_upload" };
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
