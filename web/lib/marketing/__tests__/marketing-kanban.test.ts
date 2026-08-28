import { config } from "dotenv";
config({ path: ".env.local" });

import assert from "node:assert";
import { getMarketingKanbanData } from "../marketing-kanban-service";
import { addMarketingUpdate } from "../marketing-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";

const TEST_SKU_HIGH = "TEST-MKT-KANBAN-HIGH-SKU";
const TEST_SKU_LOW = "TEST-MKT-KANBAN-LOW-SKU";

let highAssetId = "";
let lowAssetId = "";

async function cleanup() {
  for (const id of [highAssetId, lowAssetId]) {
    if (id) {
      await db.delete(auditLog).where(eq(auditLog.entityId, id));
      await db.delete(assets).where(eq(assets.id, id));
    }
  }
}

async function testMarketingKanbanFilters() {
  console.log("Testing Phase 4 marketing Kanban view & filter engine against live database...");

  const data = await getMarketingKanbanData();
  assert.ok(Array.isArray(data.statusColumns), "Must return statusColumns array");
  assert.ok(Array.isArray(data.updates), "Must return updates array");
  assert.ok(Array.isArray(data.uploadedNotMarketedAssets), "Must return uploadedNotMarketedAssets array");

  const filteredResult = await getMarketingKanbanData({
    postedThisWeekOnly: true,
    category: "Dress",
  });

  assert.ok(Array.isArray(filteredResult.updates), "Filtered query must return updates array");

  console.log("✓ All P4-T4 marketing Kanban filter assertions passed cleanly against live DB!");
}

// Real bug fix, verified: highPerformingOnly used to filter on
// marketingStatus === "high_performing", a status the brief never actually
// lists (it's a filter criterion in the brief's own words: "High-performing
// items" sits alongside "Posted this week"/"Needs repost" as something you
// filter FOR, not a lifecycle state a post has to leave Posted to enter).
// This creates two real Posted updates, one flagged highPerforming, and
// confirms the filter narrows to exactly the flagged one while both keep
// the same "posted" status.
async function testHighPerformingIsAFilterNotAStatus() {
  console.log("Verifying highPerformingOnly filters on the real flag, independent of marketingStatus...");
  await cleanup();

  const [highAsset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU_HIGH, itemName: "Test High Performer", currentStatus: "uploaded_to_roblox" })
    .returning();
  highAssetId = highAsset.id;
  const [lowAsset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU_LOW, itemName: "Test Ordinary Performer", currentStatus: "uploaded_to_roblox" })
    .returning();
  lowAssetId = lowAsset.id;

  try {
    await addMarketingUpdate({ sku: TEST_SKU_HIGH, platform: "Instagram", marketingStatus: "posted", highPerforming: true });
    await addMarketingUpdate({ sku: TEST_SKU_LOW, platform: "Instagram", marketingStatus: "posted", highPerforming: false });

    const filtered = await getMarketingKanbanData({ highPerformingOnly: true });
    const skusReturned = filtered.updates.map((u) => u.sku);
    assert.ok(skusReturned.includes(TEST_SKU_HIGH), "highPerformingOnly must include the flagged update");
    assert.ok(!skusReturned.includes(TEST_SKU_LOW), "highPerformingOnly must exclude the unflagged update");

    const unfiltered = await getMarketingKanbanData();
    const bothStatuses = unfiltered.updates.filter((u) => [TEST_SKU_HIGH, TEST_SKU_LOW].includes(u.sku));
    assert.ok(
      bothStatuses.every((u) => u.marketingStatus === "posted"),
      "Both updates must keep the same 'posted' status regardless of the highPerforming flag"
    );

    console.log("Confirmed highPerformingOnly filters on the flag, not a fake status, and status stays independent");
  } finally {
    await cleanup();
  }
}

async function main() {
  await testMarketingKanbanFilters();
  await testHighPerformingIsAFilterNotAStatus();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
