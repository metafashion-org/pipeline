import assert from "node:assert";
import { INITIAL_MARKETING_STATUSES, addMarketingUpdate } from "../marketing-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { marketingUpdates } from "@/lib/db/schema/marketing_updates";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";

const TEST_SKU = "TEST-MARKETING-SERVICE-SKU";

let assetId = "";

async function cleanup() {
  if (assetId) {
    await db.delete(auditLog).where(eq(auditLog.entityId, assetId));
    // Deleting the asset cascades to marketing_updates.
    await db.delete(assets).where(eq(assets.id, assetId));
  }
}

async function testMarketingUpdatesEngine() {
  console.log("Verifying Phase 4 marketing extension & status config engine...");

  // 1. Initial 9 marketing statuses must match the brief's §10 suggested
  // list exactly - this used to assert "uploaded_not_marketed", a status
  // the brief never names. "High Performing" must NOT be in this list -
  // it's a real flag on marketing_updates instead (see marketing_updates.ts).
  assert.strictEqual(INITIAL_MARKETING_STATUSES.length, 9, "Must have exactly 9 seeded marketing statuses from brief §10");
  const keys = INITIAL_MARKETING_STATUSES.map((s) => s.statusKey);
  for (const expectedKey of ["not_planned", "planned", "creative_needed", "scheduled", "posted", "boosted_promoted", "performance_reviewed", "needs_repost", "done"]) {
    assert.ok(keys.includes(expectedKey), `Must include the brief's ${expectedKey} status`);
  }
  assert.ok(!keys.includes("high_performing"), "High Performing must not be a status - it's a flag");

  // 2. Add marketing update check (offline error handling)
  try {
    await addMarketingUpdate({
      sku: "NON_EXISTENT_SKU_MARKETING",
      platform: "tiktok",
      marketingStatus: "posted",
    });
    assert.fail("Should reject non-existent SKU");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("Caught expected error for missing asset marketing update:", message);
    assert.ok(message.includes("not found"), "Error should report the SKU as not found");
  }

  console.log("✓ All P4-T1/P4-T2 marketing extension assertions passed cleanly!");
}

// Real bug fix, verified end to end: campaign/postType/creative/nextAction
// were either missing from addMarketingUpdate's own signature (campaign) or
// silently dropped by the API route that calls it (postType/creative/
// nextAction/highPerforming) despite real columns existing for all of them
// on marketing_updates - the brief's §10 field list names every one of
// these as something "the marketing team should be able to record."
async function testFullFieldSetPersists() {
  console.log("Verifying every brief §10 field actually persists on a real marketing update...");
  await cleanup();

  const [asset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU, itemName: "Test Marketing Asset", currentStatus: "uploaded_to_roblox" })
    .returning();
  assetId = asset.id;

  try {
    const update = await addMarketingUpdate({
      sku: TEST_SKU,
      campaign: "Summer Drop 2026",
      platform: "Instagram",
      postType: "Reel",
      postUrl: "https://instagram.com/p/test",
      creative: "recolor-hero-shot-v2",
      caption: "New colorway just dropped",
      marketingStatus: "posted",
      highPerforming: true,
      notes: "Strong early engagement",
      nextAction: "Repost to Stories in 3 days",
    });

    assert.strictEqual(update.campaign, "Summer Drop 2026");
    assert.strictEqual(update.postType, "Reel");
    assert.strictEqual(update.creative, "recolor-hero-shot-v2");
    assert.strictEqual(update.nextAction, "Repost to Stories in 3 days");
    assert.strictEqual(update.highPerforming, true);

    const [row] = await db.select().from(marketingUpdates).where(eq(marketingUpdates.assetId, assetId)).limit(1);
    assert.strictEqual(row.campaign, "Summer Drop 2026", "campaign must be a real column value, not dropped");
    assert.strictEqual(row.postType, "Reel", "postType must be a real column value, not dropped");
    assert.strictEqual(row.creative, "recolor-hero-shot-v2");
    assert.strictEqual(row.nextAction, "Repost to Stories in 3 days");
    assert.strictEqual(row.highPerforming, true, "highPerforming must default false and persist true when set");

    const [assetAfter] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    assert.strictEqual(assetAfter.marketingStatus, "posted", "assets.marketingStatus summary field must stay in sync");
    assert.ok(assetAfter.lastMarketingUpdate, "assets.lastMarketingUpdate must be set");

    console.log("Confirmed campaign/postType/creative/nextAction/highPerforming all persist to a real row");
  } finally {
    await cleanup();
  }
}

async function main() {
  await testMarketingUpdatesEngine();
  await testFullFieldSetPersists();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
