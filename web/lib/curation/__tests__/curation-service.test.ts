import assert from "node:assert";
import { updateAssetPaymentDetails } from "../curation-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { eq } from "drizzle-orm";

const TEST_SKU = "TEST-CURATION-PAYMENT-DETAILS-SKU";

async function cleanup() {
  await db.delete(assets).where(eq(assets.sku, TEST_SKU));
}

async function testUpdateAssetPaymentDetails() {
  console.log("Verifying updateAssetPaymentDetails() currency validation and update behavior...");

  // Non-existent SKU -> should throw, before any currency check even matters
  try {
    await updateAssetPaymentDetails("NON_EXISTENT_PAYMENT_DETAILS_SKU", { currency: "USD" });
    assert.fail("Should reject a non-existent SKU");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(message.includes("not found"), `Expected a not-found error, got: ${message}`);
    console.log("Caught expected error for non-existent SKU:", message);
  }

  await cleanup();
  await db.insert(assets).values({
    sku: TEST_SKU,
    itemName: "Curation Payment Details Test Asset",
    currentStatus: "in_progress",
  });

  try {
    // Currency outside INR/USD/EUR/RUB must be rejected, and rejected before any write happens.
    try {
      // @ts-expect-error deliberately passing an unsupported currency to verify the runtime guard
      await updateAssetPaymentDetails(TEST_SKU, { currency: "GBP" });
      assert.fail("Should reject an unsupported currency");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(/unsupported currency/i.test(message), `Expected a currency-rejection message, got: ${message}`);
      console.log("Caught expected rejection of unsupported currency:", message);
    }

    const [unchanged] = await db.select().from(assets).where(eq(assets.sku, TEST_SKU)).limit(1);
    assert.strictEqual(unchanged.currency, "INR", "Rejected currency update must not have written anything (default stays INR)");

    // Each supported currency should be accepted and actually persisted.
    for (const currency of ["INR", "USD", "EUR", "RUB"] as const) {
      const result = await updateAssetPaymentDetails(TEST_SKU, { currency }, undefined, "test note");
      assert.strictEqual(result.currency, currency, `Result should echo back currency ${currency}`);
      assert.strictEqual(result.sku, TEST_SKU);
      assert.strictEqual(result.currentStatus, "in_progress", "Status must remain unchanged by a payment-details update");

      const [row] = await db.select().from(assets).where(eq(assets.sku, TEST_SKU)).limit(1);
      assert.strictEqual(row.currency, currency, `DB row should actually persist currency ${currency}`);
    }

    // paymentReceiptUrl should also persist correctly (this is what satisfies the kanban payment gate).
    const withReceipt = await updateAssetPaymentDetails(TEST_SKU, { paymentReceiptUrl: "https://example.com/receipt.pdf" });
    assert.strictEqual(withReceipt.paymentReceiptUrl, "https://example.com/receipt.pdf");
    const [rowWithReceipt] = await db.select().from(assets).where(eq(assets.sku, TEST_SKU)).limit(1);
    assert.strictEqual(rowWithReceipt.paymentReceiptUrl, "https://example.com/receipt.pdf");

    console.log("Confirmed all supported currencies (INR/USD/EUR/RUB) and paymentReceiptUrl persist correctly");
  } finally {
    await cleanup();
  }

  console.log("✓ All updateAssetPaymentDetails() currency validation assertions passed cleanly!");
}

testUpdateAssetPaymentDetails()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
