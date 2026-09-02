import assert from "node:assert";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { curationItemIdeas } from "@/lib/db/schema/curation_item_ideas";
import { eq } from "drizzle-orm";
import { submitCurationItemIdea, getBriefFieldsForAsset, seedDefaultCurationFieldConfig } from "../curation-service";
import { nextSequentialSku } from "@/lib/assets/sku";

async function cleanup(sku: string) {
  const [asset] = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (asset) {
    await db.delete(curationItemIdeas).where(eq(curationItemIdeas.assetId, asset.id));
    await db.delete(assets).where(eq(assets.id, asset.id));
  }
}

async function testDynamicFieldsFlowThroughToTheBrief() {
  console.log("Verifying dynamic curation fields (rig, tech specs, etc.) actually reach the brief, not just deadline/recolor...");

  await seedDefaultCurationFieldConfig();

  const existing = await db.select({ sku: assets.sku }).from(assets);
  const expectedSku = nextSequentialSku(existing.map((a) => a.sku), new Date().getFullYear());
  await cleanup(expectedSku); // in case a prior failed run left this SKU behind

  try {
    // 1. Submitting an idea uses the REAL sequential SKU scheme (MF-<year>-<n>),
    // not the old SKU-IDEA-<timestamp> format.
    const result = await submitCurationItemIdea({
      ideaTitle: "Dynamic Field Test Item",
      fieldValues: { rig: "R15 Bundle", technicalSpecs: "512x512 texture, 4k tris max", budget: 250, targetWearer: "Y2K aesthetic" },
    });
    assert.strictEqual(result.sku, expectedSku, `New SKU should follow the real MF-<year>-<n> scheme, got: ${result.sku}`);

    // 2. The idea is linked back to the asset it created.
    const [idea] = await db.select().from(curationItemIdeas).where(eq(curationItemIdeas.id, result.idea.id)).limit(1);
    assert.strictEqual(idea.assetId, result.asset.id, "curationItemIdeas.assetId should point at the created asset");

    // 3. getBriefFieldsForAsset resolves the dynamic fields from fieldValues,
    // not just the two hardcoded asset-column ones — this is the actual gap
    // fixed here: previously only deadline/recolorInstructions ever showed up.
    const briefFields = await getBriefFieldsForAsset(result.asset.id);
    const rig = briefFields.find((f) => f.key === "rig");
    const specs = briefFields.find((f) => f.key === "technicalSpecs");
    const budget = briefFields.find((f) => f.key === "budget");
    const targetWearer = briefFields.find((f) => f.key === "targetWearer");
    assert.ok(rig && rig.value === "R15 Bundle", `rig should resolve from fieldValues, got: ${JSON.stringify(rig)}`);
    assert.ok(specs && specs.value === "512x512 texture, 4k tris max", `technicalSpecs should resolve, got: ${JSON.stringify(specs)}`);
    // Budget resolves from assets.fee_amount, not from the fieldValues copy it was submitted
    // with, so a fee changed after curation (updateAssetFee) is what the artist sees. The
    // column is numeric(10,2) and carries a currency, hence "250.00 INR" rather than "250".
    assert.ok(budget && budget.value === "250.00 INR", `budget should resolve off the asset column, got: ${JSON.stringify(budget)}`);
    assert.ok(targetWearer && targetWearer.value === "Y2K aesthetic", `targetWearer should resolve, got: ${JSON.stringify(targetWearer)}`);

    // 4. Internal-only fields (trendReasoning, whyItWillSell, comparableItems)
    // are seeded includeInArtistEmail=false and must NOT leak into the brief.
    const trendReasoning = briefFields.find((f) => f.key === "trendReasoning");
    assert.ok(!trendReasoning, "trendReasoning is internal-only and must not appear in brief fields");

    console.log("✓ All dynamic brief-field assertions passed cleanly against the live DB!");
  } finally {
    await cleanup(expectedSku);
  }
}

testDynamicFieldsFlowThroughToTheBrief()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
