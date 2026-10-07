import assert from "node:assert";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { curationFieldConfig } from "@/lib/db/schema/curation_field_config";
import { cleanBriefFields, computeAssetChanges } from "../asset-update";
import { getBriefFieldsForAsset, seedDefaultCurationFieldConfig } from "@/lib/curation/curation-service";

const SKU = "TEST-BRIEF-001";

async function cleanup() {
  await db.delete(assets).where(like(assets.sku, "TEST-BRIEF-%"));
}

async function testBriefFields() {
  console.log("Verifying an asset's own brief fields reach the artist brief, and edits are diffed by field...");
  await cleanup();
  await seedDefaultCurationFieldConfig();
  const [rig] = await db.select().from(curationFieldConfig).where(eq(curationFieldConfig.fieldKey, "rig"));
  const [trend] = await db.select().from(curationFieldConfig).where(eq(curationFieldConfig.fieldKey, "trendReasoning"));
  assert.ok(rig?.includeInArtistEmail, "Rig goes in the brief by default");
  assert.ok(trend && !trend.includeInArtistEmail, "Trend reasoning is team-only by default");

  assert.deepStrictEqual(cleanBriefFields({ rig: " Blocky ", notes: "  " }), { rig: "Blocky" }, "Empty values are dropped");

  const [asset] = await db
    .insert(assets)
    .values({ sku: SKU, itemName: "Brief test hat", currentStatus: "unassigned", briefFields: { rig: "Blocky", trendReasoning: "Christmas demand" } })
    .returning();
  const brief = await getBriefFieldsForAsset(asset.id);
  assert.ok(brief.some((f) => f.key === "rig" && f.value === "Blocky"), "An artist-facing field is in the brief");
  assert.ok(!brief.some((f) => f.key === "trendReasoning"), "A team-only field isn't");

  const diff = computeAssetChanges(
    { ...asset, briefFields: asset.briefFields },
    { briefFields: { rig: "R15", trendReasoning: "Christmas demand", notes: "" } }
  );
  assert.deepStrictEqual(diff.updates.briefFields, { rig: "R15", trendReasoning: "Christmas demand" });
  assert.deepStrictEqual(diff.changes.briefFields, { from: { rig: "Blocky" }, to: { rig: "R15" } }, "Only the changed field is logged");
  console.log("Confirmed brief fields");
}

testBriefFields()
  .then(async () => {
    await cleanup();
    console.log("✓ All asset brief field assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
