import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { statusHistory } from "@/lib/db/schema/status_history";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { recordRobloxUpload } from "../publisher-service";

const ARTIST_EMAIL = "test-paid-outside-artist@example.com";
const SKU_PREFIX = "TEST-PAIDOUT-";

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${SKU_PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(statusHistory).where(inArray(statusHistory.assetId, ids));
    await db.delete(uploadRecords).where(inArray(uploadRecords.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(personnel).where(eq(personnel.email, ARTIST_EMAIL));
}

async function testPaidOutside() {
  console.log("Verifying an asset paid outside the Kanban goes straight to Payment Done once its Roblox link is in...");
  await cleanup();
  const [artist] = await db.insert(personnel).values({ name: "Paid Outside Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  await db.insert(assets).values([
    { sku: `${SKU_PREFIX}PAID`, itemName: "Already paid hat", currentStatus: "ready_for_upload", currentArtistId: artist.id, paidOutsideAt: new Date(), paidOutsideNote: "Paid before the switch" },
    { sku: `${SKU_PREFIX}OWED`, itemName: "Still owed hat", currentStatus: "ready_for_upload", currentArtistId: artist.id },
  ]);

  const paid = await recordRobloxUpload({ sku: `${SKU_PREFIX}PAID`, robloxItemUrls: ["https://www.roblox.com/catalog/111/Already-paid-hat"] });
  assert.strictEqual(paid.currentStatus, "payment_done");
  const [paidRow] = await db.select().from(assets).where(eq(assets.sku, `${SKU_PREFIX}PAID`));
  assert.strictEqual(paidRow.currentStatus, "payment_done", "No invoice needed for an asset paid outside the Kanban");
  assert.strictEqual(paidRow.paymentReceiptUrl, null);

  const owed = await recordRobloxUpload({ sku: `${SKU_PREFIX}OWED`, robloxItemUrls: ["https://www.roblox.com/catalog/222/Still-owed-hat"] });
  assert.strictEqual(owed.currentStatus, "uploaded_to_roblox", "A normal asset waits to be paid");
  console.log("Confirmed paid-outside assets");
}

testPaidOutside()
  .then(async () => {
    await cleanup();
    console.log("✓ All paid-outside assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
