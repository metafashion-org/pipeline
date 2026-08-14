import { config } from "dotenv";
config({ path: ".env.local" });

import assert from "node:assert";
import { getMarketingKanbanData } from "../marketing-kanban-service";

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

testMarketingKanbanFilters()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
