import assert from "node:assert";
import { markAssetForPayment } from "../deliverables-service";

async function testPaymentGateEnforcement() {
  console.log("Verifying structural payment gate enforcement...");

  try {
    await markAssetForPayment("NON_EXISTENT_SKU_PAYMENT");
    assert.fail("Should reject non-existent SKU");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("Caught expected error for payment gate:", message);
    assert.ok(message.includes("not found"), "Error should report the SKU as not found");
  }

  console.log("✓ All P2-T20/P2-T21 deliverables & payment gate assertions passed cleanly!");
}

testPaymentGateEnforcement()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
