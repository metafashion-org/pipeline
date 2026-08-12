import assert from "node:assert";
import { sql, eq, inArray } from "drizzle-orm";
import { isPayoutDay, runPaymentCyclePull } from "../payment-cycle-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { paymentCycles } from "@/lib/db/schema/payment_cycles";
import { paymentCycleItems } from "@/lib/db/schema/payment_cycle_items";

function testIsPayoutDay() {
  console.log("Verifying isPayoutDay()...");

  assert.strictEqual(isPayoutDay(new Date(2026, 0, 15)), true, "the 15th is always a payout day");
  assert.strictEqual(isPayoutDay(new Date(2026, 0, 31)), true, "Jan 31 is the last day of a 31-day month");
  assert.strictEqual(isPayoutDay(new Date(2026, 3, 30)), true, "Apr 30 is the last day of a 30-day month");
  assert.strictEqual(isPayoutDay(new Date(2026, 1, 28)), true, "Feb 28 is the last day in a non-leap year (2026)");
  assert.strictEqual(isPayoutDay(new Date(2024, 1, 29)), true, "Feb 29 is the last day in a leap year (2024)");
  assert.strictEqual(isPayoutDay(new Date(2024, 1, 28)), false, "Feb 28 is NOT the last day in a leap year (2024 has 29)");

  assert.strictEqual(isPayoutDay(new Date(2026, 0, 1)), false, "the 1st is not a payout day");
  assert.strictEqual(isPayoutDay(new Date(2026, 0, 14)), false, "the 14th is not a payout day");
  assert.strictEqual(isPayoutDay(new Date(2026, 0, 16)), false, "the 16th is not a payout day");

  console.log("✓ All isPayoutDay assertions passed cleanly!");
}

// Far-future date so this never collides with a real production cycle
// (the live app actually runs a pull on every real 15th/month-end).
const PAYOUT_DATE = new Date(2099, 0, 15);
const NON_PAYOUT_DATE = new Date(2099, 0, 3);

const ELIGIBLE_SKU_1 = "TEST-PAYCYCLE-ELIGIBLE-1";
const ELIGIBLE_SKU_2 = "TEST-PAYCYCLE-ELIGIBLE-2";
const INELIGIBLE_SKU = "TEST-PAYCYCLE-INELIGIBLE";
const TEST_SKUS = [ELIGIBLE_SKU_1, ELIGIBLE_SKU_2, INELIGIBLE_SKU];

async function cleanup() {
  // Deleting the cycle cascades its items (payment_cycle_items.cycle_id has onDelete: cascade).
  await db.delete(paymentCycles).where(eq(paymentCycles.cycleDate, "2099-01-15"));
  await db.delete(assets).where(inArray(assets.sku, TEST_SKUS));
}

async function testRunPaymentCyclePull() {
  console.log("Verifying runPaymentCyclePull() against a live DB...");

  await cleanup(); // in case a previous failed run left rows behind

  await db.insert(assets).values([
    { sku: ELIGIBLE_SKU_1, itemName: "Eligible Asset 1", currentStatus: "marked_for_payment", feeAmount: "150.00", currency: "USD" },
    { sku: ELIGIBLE_SKU_2, itemName: "Eligible Asset 2", currentStatus: "uploaded_to_roblox", feeAmount: "75.50", currency: "EUR" },
    { sku: INELIGIBLE_SKU, itemName: "Ineligible Asset", currentStatus: "in_progress", feeAmount: "999.00", currency: "USD" },
  ]);

  try {
    // 1. A real payout day: only the eligible assets should land as snapshot rows.
    const result = await runPaymentCyclePull(PAYOUT_DATE);
    assert.ok(!("skipped" in result), `Expected a real pull, got skip: ${JSON.stringify(result)}`);
    assert.ok(result.cycleId, "Expected a created cycle id");
    console.log(`Pull created cycle ${result.cycleId} with ${result.itemCount} total items`);

    const testAssetRows = await db
      .select()
      .from(assets)
      .where(inArray(assets.sku, TEST_SKUS));
    const idBySku = new Map(testAssetRows.map((a) => [a.sku, a.id]));

    const items = await db
      .select()
      .from(paymentCycleItems)
      .where(eq(paymentCycleItems.cycleId, result.cycleId));
    const itemsByAssetId = new Map(items.map((i) => [i.assetId, i]));

    const item1 = itemsByAssetId.get(idBySku.get(ELIGIBLE_SKU_1)!);
    assert.ok(item1, "Eligible asset 1 should have landed in payment_cycle_items");
    assert.strictEqual(item1!.sku, ELIGIBLE_SKU_1);
    assert.strictEqual(item1!.feeAmount, "150.00");
    assert.strictEqual(item1!.currency, "USD");

    const item2 = itemsByAssetId.get(idBySku.get(ELIGIBLE_SKU_2)!);
    assert.ok(item2, "Eligible asset 2 should have landed in payment_cycle_items");
    assert.strictEqual(item2!.sku, ELIGIBLE_SKU_2);
    assert.strictEqual(item2!.feeAmount, "75.50");
    assert.strictEqual(item2!.currency, "EUR");

    assert.strictEqual(
      itemsByAssetId.has(idBySku.get(INELIGIBLE_SKU)!),
      false,
      "Ineligible (in_progress) asset should NOT have landed in payment_cycle_items"
    );
    console.log("Confirmed status filter: only eligible assets snapshotted, with matching sku/feeAmount/currency");

    // 2. Same payout day again: idempotent, no duplicate cycle or items.
    const secondResult = await runPaymentCyclePull(PAYOUT_DATE);
    assert.ok("skipped" in secondResult && secondResult.skipped === true, "Second call on the same payout day should skip");
    console.log("Confirmed idempotency skip reason:", secondResult.reason);

    const cyclesForDate = await db.select().from(paymentCycles).where(eq(paymentCycles.cycleDate, "2099-01-15"));
    assert.strictEqual(cyclesForDate.length, 1, "Should still be exactly one cycle for the payout date, no duplicate");

    const itemsAfterSecondRun = await db
      .select()
      .from(paymentCycleItems)
      .where(eq(paymentCycleItems.cycleId, result.cycleId));
    assert.strictEqual(itemsAfterSecondRun.length, items.length, "Item count should be unchanged after the repeat call");
    console.log("Confirmed no duplicate cycle or items were inserted on the repeat call");

    // 3. A non-payout day: should skip before touching either table at all.
    const [{ cycleCountBefore }] = await db.select({ cycleCountBefore: sql<number>`count(*)::int` }).from(paymentCycles);
    const [{ itemCountBefore }] = await db.select({ itemCountBefore: sql<number>`count(*)::int` }).from(paymentCycleItems);

    const thirdResult = await runPaymentCyclePull(NON_PAYOUT_DATE);
    assert.ok("skipped" in thirdResult && thirdResult.skipped === true, "A non-payout day should skip");

    const [{ cycleCountAfter }] = await db.select({ cycleCountAfter: sql<number>`count(*)::int` }).from(paymentCycles);
    const [{ itemCountAfter }] = await db.select({ itemCountAfter: sql<number>`count(*)::int` }).from(paymentCycleItems);
    assert.strictEqual(cycleCountAfter, cycleCountBefore, "payment_cycles row count should be untouched on a non-payout day");
    assert.strictEqual(itemCountAfter, itemCountBefore, "payment_cycle_items row count should be untouched on a non-payout day");
    console.log("Confirmed a non-payout day never touches payment_cycles/payment_cycle_items");
  } finally {
    await cleanup();
  }

  console.log("✓ All runPaymentCyclePull assertions passed cleanly against a live DB!");
}

testIsPayoutDay();

testRunPaymentCyclePull()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
