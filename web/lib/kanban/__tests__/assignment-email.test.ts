import assert from "node:assert";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { assignArtistToAsset } from "../assignment-service";
import { eq } from "drizzle-orm";

// Regression test for P2-T16b: assignArtistToAsset() used to update the DB
// and stop - no email was ever queued, so the P2-T17/P2-T18/P3-T9 pieces
// were each independently tested but never actually called together.
const TEST_SKU = "__p2_t16b_test_sku__";
const TEST_ARTIST_EMAIL = "__p2_t16b_test_artist__@example.com";

async function testAssignmentQueuesRealEmail() {
  const [artist] = await db
    .insert(personnel)
    .values({ name: "Test Artist", email: TEST_ARTIST_EMAIL, roles: ["artist"], status: "Active" })
    .returning();
  const [asset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU, itemName: "Test Item", category: "Dress", currentStatus: "unassigned" })
    .returning();

  try {
    const result = await assignArtistToAsset({ assetId: asset.id, artistId: artist.id });
    assert.ok(result.queuedEmailId, "assignArtistToAsset must return a queuedEmailId");

    const [queued] = await db.select().from(emailQueue).where(eq(emailQueue.id, result.queuedEmailId)).limit(1);
    assert.ok(queued, "A matching row must exist in email_queue");
    assert.strictEqual(queued.toEmail, TEST_ARTIST_EMAIL, "Queued email must go to the assigned artist");
    assert.strictEqual(queued.status, "pending", "Queued email must start pending, not silently skipped");
    assert.ok(queued.subject.includes(TEST_SKU), "Subject must use the real P2-T18 template, not a placeholder");
    assert.ok(queued.bodyHtml.includes("Test Item"), "Body must be the real rendered template");

    console.log("✓ assignArtistToAsset() queues a real, correctly-addressed email end to end");
  } finally {
    await db.delete(emailQueue).where(eq(emailQueue.assetId, asset.id));
    await db.delete(assets).where(eq(assets.id, asset.id));
    await db.delete(personnel).where(eq(personnel.id, artist.id));
  }
}

testAssignmentQueuesRealEmail()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err.message);
    process.exit(1);
  });
