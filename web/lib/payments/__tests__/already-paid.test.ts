import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { personnel } from "@/lib/db/schema/personnel";
import { statusHistory } from "@/lib/db/schema/status_history";
import { AlreadyPaidError, getArtistsPendingPayment, markAssetPaidOutside } from "../payment-batch-service";

const PREFIX = "TEST-ALREADYPAID-";

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(statusHistory).where(inArray(statusHistory.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(personnel).where(like(personnel.email, "test-alreadypaid-%"));
}

async function test() {
  console.log("Verifying an asset already paid outside the Kanban moves to Payment Done and drops off the owed list...");
  await cleanup();
  const [artist] = await db.insert(personnel).values({ name: "Paid Artist", email: "test-alreadypaid-artist@example.com", roles: ["artist"], status: "Active" }).returning();
  const [paidCard, owedCard, otherCard] = await db
    .insert(assets)
    .values([
      { sku: `${PREFIX}PAID`, itemName: "Paid already", currentStatus: "marked_for_payment", currentArtistId: artist.id, feeAmount: "500.00" },
      { sku: `${PREFIX}OWED`, itemName: "Still owed", currentStatus: "marked_for_payment", currentArtistId: artist.id, feeAmount: "700.00" },
      { sku: `${PREFIX}OTHER`, itemName: "Not waiting", currentStatus: "uploaded_to_roblox", currentArtistId: artist.id },
    ])
    .returning();
  const admin = { roles: ["admin"] };

  await assert.rejects(markAssetPaidOutside(paidCard.sku, "   ", admin), AlreadyPaidError, "A note is required");
  await assert.rejects(markAssetPaidOutside(otherCard.sku, "UPI", admin), AlreadyPaidError, "Only cards in Marked for Payment");
  const [untouched] = await db.select().from(assets).where(eq(assets.id, paidCard.id));
  assert.strictEqual(untouched.currentStatus, "marked_for_payment");
  assert.strictEqual(untouched.paidOutsideAt, null);

  await markAssetPaidOutside(paidCard.sku, " UPI on 14 Oct ", admin);
  const [done] = await db.select().from(assets).where(eq(assets.id, paidCard.id));
  assert.strictEqual(done.currentStatus, "payment_done");
  assert.ok(done.paidOutsideAt);
  assert.strictEqual(done.paidOutsideNote, "UPI on 14 Oct");
  assert.strictEqual(done.paymentReceiptUrl, null, "No invoice is attached");
  const history = await db.select().from(statusHistory).where(eq(statusHistory.assetId, paidCard.id));
  assert.ok(history.some((h) => h.toStatus === "payment_done" && h.note?.includes("UPI on 14 Oct")));
  const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, paidCard.id));
  assert.ok(audit.some((a) => a.action === "markPaidOutside"));

  const pending = (await getArtistsPendingPayment()).find((a) => a.artistId === artist.id);
  assert.deepStrictEqual(pending?.assets.map((a) => a.sku), [owedCard.sku], "Only the unpaid card is still owed");
  console.log("Confirmed already-paid");
}

test()
  .then(async () => {
    await cleanup();
    console.log("✓ All already-paid assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
