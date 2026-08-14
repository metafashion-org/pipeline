import assert from "node:assert";
import { INITIAL_MARKETING_STATUSES, addMarketingUpdate } from "../marketing-service";

async function testMarketingUpdatesEngine() {
  console.log("Verifying Phase 4 marketing extension & status config engine...");

  // 1. Initial 9 marketing statuses count check
  assert.strictEqual(INITIAL_MARKETING_STATUSES.length, 9, "Must have exactly 9 seeded marketing statuses from brief §10");
  assert.ok(
    INITIAL_MARKETING_STATUSES.some((s) => s.statusKey === "uploaded_not_marketed"),
    "Must include uploaded_not_marketed status"
  );

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

testMarketingUpdatesEngine()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
