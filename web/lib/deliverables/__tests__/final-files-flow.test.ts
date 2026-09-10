import assert from "node:assert";
import { submitFinalDeliverables, notifyUploader } from "../deliverables-service";
import { recordRobloxUpload } from "@/lib/publisher/publisher-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, and } from "drizzle-orm";

const TEST_SKU = "TEST-FINAL-FILES-FLOW-SKU";
const ARTIST_EMAIL = "test-final-files-flow-artist@example.com";

let assetId = "";

async function cleanup() {
  if (assetId) {
    await db.delete(auditLog).where(eq(auditLog.entityId, assetId));
    // Deleting the asset cascades to status_history and upload_records.
    await db.delete(assets).where(eq(assets.id, assetId));
  }
  await db.delete(personnel).where(eq(personnel.email, ARTIST_EMAIL));
}

// Real bug fix, verified end-to-end against the live DB: submitFinalDeliverables
// had no status/file validation at all before this round (brief §8: must be
// Approved, must have files). notifyUploader and the roblox-upload status gate
// (brief §5/§9) didn't exist anywhere until this round either — both were
// fully orphaned functions with no route or UI. This walks the real
// approved -> final_files_received -> ready_for_upload -> uploaded_to_roblox
// chain, asserting each rejection and each real transition against the
// actual database rows, not just the returned value.
async function testFinalFilesUploaderRobloxFlow() {
  console.log("Verifying the Approved -> Final Files -> Ready for Upload -> Uploaded to Roblox chain end to end...");
  await cleanup();

  const [artist] = await db
    .insert(personnel)
    .values({ name: "Test Final Files Artist", email: ARTIST_EMAIL, roles: ["artist"] })
    .returning();
  const [asset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU, itemName: "Test Final Files Asset", currentStatus: "in_progress", currentArtistId: artist.id })
    .returning();
  assetId = asset.id;

  try {
    // 1. submitFinalDeliverables must reject an asset that isn't Approved yet.
    try {
      await submitFinalDeliverables(TEST_SKU, ["https://drive.google.com/file/1"], artist.id);
      assert.fail("Should reject submission when asset is not Approved");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(message.includes("must be in Approved status"), `Unexpected rejection message: ${message}`);
    }
    const [rejectionAudit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, assetId), eq(auditLog.action, "submitFinalDeliverables_rejected")));
    assert.ok(rejectionAudit, "Wrong-status rejection must be audit-logged");
    console.log("Confirmed submitFinalDeliverables rejects a non-Approved asset and audit-logs it");

    // Move the asset to Approved so the real submission can proceed.
    await db.update(assets).set({ currentStatus: "approved" }).where(eq(assets.id, assetId));

    // 2. submitFinalDeliverables must reject an empty file list.
    try {
      await submitFinalDeliverables(TEST_SKU, ["   ", ""], artist.id);
      assert.fail("Should reject submission with no real file URLs");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(message.includes("at least one final file is required"), `Unexpected rejection message: ${message}`);
    }
    console.log("Confirmed submitFinalDeliverables rejects an empty file list");

    // 3. A real, valid submission must succeed and transition the asset.
    const submitResult = await submitFinalDeliverables(
      TEST_SKU,
      ["https://drive.google.com/file/final-1", "https://drive.google.com/file/final-2"],
      artist.id,
      "Final rig + textures"
    );
    assert.strictEqual(submitResult.currentStatus, "final_files_received");

    const [assetAfterSubmit] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    assert.strictEqual(assetAfterSubmit.currentStatus, "final_files_received");
    const refs = assetAfterSubmit.referenceImages as any[];
    assert.ok(refs.some((r) => r.externalId === "https://drive.google.com/file/final-1"), "Final file URL must be appended to referenceImages");

    const [submitHistory] = await db
      .select()
      .from(statusHistory)
      .where(and(eq(statusHistory.assetId, assetId), eq(statusHistory.toStatus, "final_files_received")));
    assert.ok(submitHistory, "Approved -> Final Files Received transition must be logged in status history");
    console.log("Confirmed a valid final-files submission transitions the asset and appends the files");

    // 4. notifyUploader must reject an asset still short of Final Files Received.
    await db.update(assets).set({ currentStatus: "in_review" }).where(eq(assets.id, assetId));
    try {
      await notifyUploader(TEST_SKU);
      assert.fail("Should reject notifyUploader when final files were never received");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(message.includes("must have final files received first"), `Unexpected rejection message: ${message}`);
    }
    console.log("Confirmed notifyUploader rejects an asset without final files received");

    // 5. notifyUploader on a real Final Files Received asset must succeed.
    await db.update(assets).set({ currentStatus: "final_files_received" }).where(eq(assets.id, assetId));
    const notifyResult = await notifyUploader(TEST_SKU, undefined, "Folder ready, go ahead");
    assert.strictEqual(notifyResult.currentStatus, "ready_for_upload");

    const [assetAfterNotify] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    assert.strictEqual(assetAfterNotify.currentStatus, "ready_for_upload");
    console.log("Confirmed notifyUploader transitions Final Files Received -> Ready for Upload");

    // 6. recordRobloxUpload must reject an asset that isn't Ready for Upload.
    await db.update(assets).set({ currentStatus: "final_files_received" }).where(eq(assets.id, assetId));
    try {
      await recordRobloxUpload({ sku: TEST_SKU, robloxItemUrls: ["https://www.roblox.com/catalog/12345/Test-Hat"] });
      assert.fail("Should reject a Roblox upload when the asset isn't Ready for Upload");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(message.includes("must be Ready for Upload"), `Unexpected rejection message: ${message}`);
    }
    console.log("Confirmed recordRobloxUpload rejects an asset that isn't Ready for Upload");

    // 7. A real Roblox upload on a Ready for Upload asset must succeed.
    await db.update(assets).set({ currentStatus: "ready_for_upload" }).where(eq(assets.id, assetId));
    const robloxResult = await recordRobloxUpload({
      sku: TEST_SKU,
      robloxItemUrls: ["https://www.roblox.com/catalog/999999/Test-Hat"],
    });
    assert.strictEqual(robloxResult.currentStatus, "uploaded_to_roblox");

    const [assetAfterRoblox] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    assert.strictEqual(assetAfterRoblox.currentStatus, "uploaded_to_roblox");

    const [uploadRecord] = await db.select().from(uploadRecords).where(eq(uploadRecords.assetId, assetId));
    assert.ok(uploadRecord, "A real upload_records row must be written");
    assert.strictEqual(uploadRecord.robloxItemUrl, "https://www.roblox.com/catalog/999999/Test-Hat");
    // Read out of the link rather than typed: the separate "Roblox asset ID" field is gone.
    assert.strictEqual(uploadRecord.robloxAssetId, "999999");
    console.log("Confirmed a valid Roblox upload transitions the asset and writes a real upload_records row");

    console.log("✓ Full Approved -> Final Files -> Ready for Upload -> Uploaded to Roblox chain verified against the live DB");
  } finally {
    await cleanup();
  }
}

async function main() {
  await testFinalFilesUploaderRobloxFlow();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
