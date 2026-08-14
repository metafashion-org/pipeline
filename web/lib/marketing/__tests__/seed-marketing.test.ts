import assert from "node:assert";
import { seedMarketingStatuses } from "../marketing-service";
import { db } from "@/lib/db/client";
import { marketingStatusConfig } from "@/lib/db/schema/marketing_status_config";
import { asc, eq, inArray } from "drizzle-orm";

// Expected keys and labels are written out literally here rather than imported from
// INITIAL_MARKETING_STATUSES in ../marketing-service — comparing the seed's source array to itself
// would pass even if the seed function wrote nothing at all. This is the one check that actually
// catches the seed drifting from what the app expects.
const EXPECTED = [
  { statusKey: "uploaded_not_marketed", label: "Uploaded Not Marketed" },
  { statusKey: "creative_in_progress", label: "Creative in Progress" },
  { statusKey: "scheduled", label: "Scheduled" },
  { statusKey: "posted", label: "Posted" },
  { statusKey: "high_performing", label: "High Performing" },
  { statusKey: "needs_repost", label: "Needs Repost" },
  { statusKey: "archived_campaign", label: "Archived Campaign" },
  { statusKey: "paused", label: "Paused" },
  { statusKey: "rejected", label: "Rejected" },
];
const EXPECTED_KEYS = EXPECTED.map((s) => s.statusKey);

async function cleanup() {
  await db.delete(marketingStatusConfig).where(inArray(marketingStatusConfig.statusKey, EXPECTED_KEYS));
}

async function readSeededRows() {
  return db
    .select({ statusKey: marketingStatusConfig.statusKey, label: marketingStatusConfig.label })
    .from(marketingStatusConfig)
    .where(inArray(marketingStatusConfig.statusKey, EXPECTED_KEYS))
    .orderBy(asc(marketingStatusConfig.sortOrder));
}

async function testSeedMarketingStatuses() {
  console.log("Verifying marketing status seed writes the expected rows...");
  await cleanup();

  try {
    // First run: seeding an empty table should write exactly the 9 expected rows, in sort order.
    await seedMarketingStatuses();
    const firstRun = await readSeededRows();
    assert.strictEqual(firstRun.length, EXPECTED.length, `Should seed exactly ${EXPECTED.length} marketing statuses`);
    assert.deepStrictEqual(firstRun, EXPECTED, "Seeded keys and labels should match the expected set, in sortOrder");

    // Second run: re-seeding must not error and must not create duplicates or change the row set.
    await seedMarketingStatuses();
    const secondRun = await readSeededRows();
    assert.strictEqual(secondRun.length, EXPECTED.length, "Re-seeding should not change the row count");
    assert.deepStrictEqual(secondRun, EXPECTED, "Re-seeding should not change keys, labels, or order");

    const uniqueKeys = new Set(secondRun.map((r) => r.statusKey));
    assert.strictEqual(uniqueKeys.size, secondRun.length, "Re-seeding should not create duplicate status_key rows");

    console.log("✓ Marketing status seed assertions passed cleanly!");
  } finally {
    await cleanup();
  }
}

testSeedMarketingStatuses()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
