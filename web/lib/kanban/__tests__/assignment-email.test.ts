import assert from "node:assert";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { assetOffers } from "@/lib/db/schema/asset_offers";
import { assignArtistToAsset } from "../assignment-service";
import { and, eq } from "drizzle-orm";

// Assigning an artist must actually reach them: an offer row, and an offer email queued to them.
// The full brief follows only once they accept (see offers.test.ts).
const TEST_SKU = "__p2_t16b_test_sku__";
const TEST_ARTIST_EMAIL = "__p2_t16b_test_artist__@example.com";

async function testAssignmentSendsOffer() {
  const [artist] = await db
    .insert(personnel)
    .values({ name: "Test Artist", email: TEST_ARTIST_EMAIL, roles: ["artist"], status: "Active" })
    .returning();
  const [asset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU, itemName: "Test Item", category: "Dress", currentStatus: "unassigned", deadline: new Date("2026-10-10") })
    .returning();

  try {
    const result = await assignArtistToAsset({ assetId: asset.id, artistId: artist.id });
    assert.ok(result.offerId, "assignArtistToAsset must return the offer it sent");

    const [offer] = await db.select().from(assetOffers).where(eq(assetOffers.id, result.offerId)).limit(1);
    assert.ok(offer, "An asset_offers row must exist");
    assert.strictEqual(offer.status, "pending");
    assert.strictEqual(offer.artistId, artist.id);
    assert.strictEqual(new Date(offer.offeredDeadline).toISOString().slice(0, 10), "2026-10-10", "The offer carries the asset's deadline");

    const [queued] = await db
      .select()
      .from(emailQueue)
      .where(and(eq(emailQueue.assetId, asset.id), eq(emailQueue.toEmail, TEST_ARTIST_EMAIL)))
      .limit(1);
    assert.ok(queued, "An offer email must be queued to the artist");
    assert.ok(queued.subject.startsWith("New asset offer"), "The queued email must be the offer, not the full brief");
    assert.ok(queued.subject.includes(TEST_SKU), "The subject names the SKU");
    assert.ok(queued.bodyHtml.includes("Test Item"), "The body names the asset");

    console.log("✓ assignArtistToAsset() sends an offer and queues the offer email");
  } finally {
    await db.delete(assets).where(eq(assets.id, asset.id));
    await db.delete(personnel).where(eq(personnel.id, artist.id));
  }
}

async function testAssignmentWithoutDeadlineIsRefused() {
  const [artist] = await db
    .insert(personnel)
    .values({ name: "Test Artist", email: TEST_ARTIST_EMAIL, roles: ["artist"], status: "Active" })
    .returning();
  const [asset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU, itemName: "Test Item", currentStatus: "unassigned" })
    .returning();

  try {
    await assert.rejects(
      () => assignArtistToAsset({ assetId: asset.id, artistId: artist.id }),
      /deadline/,
      "An asset with no deadline, assigned without one, must be refused"
    );
    console.log("✓ assignArtistToAsset() refuses an assignment with no deadline to offer");
  } finally {
    await db.delete(assets).where(eq(assets.id, asset.id));
    await db.delete(personnel).where(eq(personnel.id, artist.id));
  }
}

async function main() {
  await testAssignmentSendsOffer();
  await testAssignmentWithoutDeadlineIsRefused();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err.message);
    process.exit(1);
  });
