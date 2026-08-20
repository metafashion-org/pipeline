import assert from "node:assert";
import { computeAssetChanges, UpdateAssetSchema } from "../asset-update";

function testFeeAmountNumericComparison() {
  console.log("Verifying feeAmount is compared numerically, not as a string...");

  const current = {
    itemName: "Test Item",
    category: null,
    feeAmount: "1000.00",
    currency: "USD",
    deadline: null,
    paymentReceiptUrl: null,
  };

  // Same value, differently formatted (Postgres numeric round-trip vs a plain form input) -> no phantom change
  const same = computeAssetChanges(current, { feeAmount: "1000" });
  assert.deepStrictEqual(same.changes, {}, "Numerically equal feeAmount must not be recorded as a change");
  assert.deepStrictEqual(same.updates, {}, "Numerically equal feeAmount must not be written");

  // Genuinely different value -> recorded and written
  const changed = computeAssetChanges(current, { feeAmount: "1500" });
  assert.strictEqual(changed.changes.feeAmount.from, "1000.00");
  assert.strictEqual(changed.changes.feeAmount.to, "1500");
  assert.strictEqual(changed.updates.feeAmount, "1500");

  // Clearing to null -> recorded
  const cleared = computeAssetChanges(current, { feeAmount: null });
  assert.deepStrictEqual(cleared.changes.feeAmount, { from: "1000.00", to: null });

  console.log("✓ feeAmount numeric comparison assertions passed cleanly!");
}

function testDeadlineRejection() {
  console.log("Verifying an invalid deadline is rejected instead of stored as Invalid Date...");

  const invalid = UpdateAssetSchema.safeParse({ deadline: "not-a-date" });
  assert.strictEqual(invalid.success, false, "A non-parseable deadline string must fail validation");

  const valid = UpdateAssetSchema.safeParse({ deadline: "2026-09-01" });
  assert.strictEqual(valid.success, true, "A valid ISO date string must pass validation");

  const nullDeadline = UpdateAssetSchema.safeParse({ deadline: null });
  assert.strictEqual(nullDeadline.success, true, "null must be accepted to clear the deadline");

  console.log("✓ Deadline rejection assertions passed cleanly!");
}

function testNoFieldsSentMeansNoChange() {
  console.log("Verifying an unsent field never appears in changes or updates...");

  const current = {
    itemName: "Test Item",
    category: "Tops",
    feeAmount: "1000.00",
    currency: "USD",
    deadline: new Date("2026-01-01T00:00:00.000Z"),
    paymentReceiptUrl: null,
  };

  const result = computeAssetChanges(current, { itemName: "Test Item" });
  assert.deepStrictEqual(result.changes, {}, "Unchanged itemName must not be recorded");
  assert.deepStrictEqual(result.updates, {}, "No field was actually sent-different, so nothing should be written");

  console.log("✓ No-op update assertions passed cleanly!");
}

testFeeAmountNumericComparison();
testDeadlineRejection();
testNoFieldsSentMeansNoChange();
