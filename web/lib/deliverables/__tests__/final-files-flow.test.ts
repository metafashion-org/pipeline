import assert from "node:assert";
import { submitFinalFiles, notifyUploader, getFinalFilesForAsset, nextFinalFilesVersion, type FinalFileInput } from "../deliverables-service";
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

// What the route passes in after reading the files back from Drive; no Drive call in this test.
function fakeFile(name: string): FinalFileInput {
  return {
    fileName: name,
    mimeType: "application/octet-stream",
    sizeBytes: 1024,
    driveFileId: `drive-${name}`,
    driveUrl: `https://drive.google.com/file/d/drive-${name}/view`,
    driveFolderId: "folder-v1",
  };
}

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
    // 1. submitFinalFiles must reject an asset that isn't Approved yet.
    try {
      await submitFinalFiles(TEST_SKU, 1, [fakeFile("rig.fbx")], artist.id);
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
    console.log("Confirmed submitFinalFiles rejects a non-Approved asset and audit-logs it");

    // Move the asset to Approved so the real submission can proceed.
    await db.update(assets).set({ currentStatus: "approved" }).where(eq(assets.id, assetId));

    // 2. submitFinalFiles must reject an empty file list.
    try {
      await submitFinalFiles(TEST_SKU, 1, [], artist.id);
      assert.fail("Should reject submission with no files");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(message.includes("at least one final file is required"), `Unexpected rejection message: ${message}`);
    }
    console.log("Confirmed submitFinalFiles rejects an empty file list");

    // 3. A valid submission records the files and puts the asset straight in the uploader's queue.
    assert.strictEqual(await nextFinalFilesVersion(assetId), 1, "The first submission is version 1");
    const submitResult = await submitFinalFiles(TEST_SKU, 1, [fakeFile("rig.fbx"), fakeFile("textures.zip")], artist.id, "Final rig + textures");
    assert.strictEqual(submitResult.currentStatus, "ready_for_upload");

    const [assetAfterSubmit] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    assert.strictEqual(assetAfterSubmit.currentStatus, "ready_for_upload", "Handing in final files marks the asset Ready for Upload");
    assert.deepStrictEqual(assetAfterSubmit.referenceImages, [], "Final files no longer get mixed into the reference images");

    const submissions = await getFinalFilesForAsset(assetId);
    assert.strictEqual(submissions.length, 1);
    assert.strictEqual(submissions[0].version, 1);
    assert.deepStrictEqual(submissions[0].files.map((f) => f.fileName), ["rig.fbx", "textures.zip"]);
    assert.strictEqual(await nextFinalFilesVersion(assetId), 2, "The next submission would be version 2");

    const history = await db.select().from(statusHistory).where(eq(statusHistory.assetId, assetId));
    assert.ok(history.some((h) => h.toStatus === "final_files_received"), "Approved -> Final Files Received must be in status history");
    assert.ok(history.some((h) => h.toStatus === "ready_for_upload"), "Final Files Received -> Ready for Upload must be in status history");
    console.log("Confirmed a valid submission records the files and moves the asset to Ready for Upload");

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
