import assert from "node:assert";
import { updateAssetStatusInKanban } from "../kanban-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { eq } from "drizzle-orm";

const TEST_SKU = "TEST-TRANSITION-GATE-SKU";

async function testTransitionRulesEnforcement() {
  console.log("Verifying transition rule enforcement server-side...");

  // Testing invalid status key
  try {
    await updateAssetStatusInKanban("TEST_SKU", "NON_EXISTENT_STATUS");
    assert.fail("Should reject invalid status key");
  } catch (err: unknown) {
    console.log("Caught expected error for invalid status key:", err instanceof Error ? err.message : err);
  }

  // Seed a real asset directly at "uploaded_to_roblox" so we can test the payment gate
  // (Uploaded to Roblox -> Marked for Payment is allowed; Uploaded to Roblox -> Payment Done
  // directly is not, per PLAN.md §4/§9 — this is the actual business rule P2-T23 depends on.)
  await db.delete(assets).where(eq(assets.sku, TEST_SKU));
  await db.insert(assets).values({
    sku: TEST_SKU,
    itemName: "Transition Gate Test Asset",
    currentStatus: "uploaded_to_roblox",
  });

  try {
    // Disallowed: skips the payment gate (uploaded_to_roblox -> payment_done directly)
    try {
      await updateAssetStatusInKanban(TEST_SKU, "payment_done");
      assert.fail("Payment gate bypass should have been rejected (uploaded_to_roblox -> payment_done with no rule row)");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(/not permitted|forbidden/.test(message), `Expected a rejection message, got: ${message}`);
      console.log("Caught expected rejection of payment-gate bypass:", message);
    }

    // Disallowed even for admin: the payment gate is structural per PLAN.md §4/§9,
    // not just a permission check, so admin's "move anywhere" override must not apply here.
    try {
      await updateAssetStatusInKanban(TEST_SKU, "payment_done", "admin");
      assert.fail("Payment gate bypass should be rejected even for admin");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(/not permitted|forbidden/.test(message), `Expected a rejection message, got: ${message}`);
      console.log("Caught expected rejection of payment-gate bypass for admin role too:", message);
    }

    // Allowed: uploaded_to_roblox -> marked_for_payment is a real seeded rule
    const result = await updateAssetStatusInKanban(TEST_SKU, "marked_for_payment");
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.toStatus, "marked_for_payment");
    console.log("Confirmed allowed transition succeeds: uploaded_to_roblox -> marked_for_payment");
  } finally {
    await db.delete(assets).where(eq(assets.sku, TEST_SKU));
  }

  // Admin override: a normal (non-payment-gated) transition with no matching rule row
  // should now succeed for admin — this is the actual bug being fixed here.
  await db.delete(assets).where(eq(assets.sku, TEST_SKU));
  await db.insert(assets).values({
    sku: TEST_SKU,
    itemName: "Admin Override Test Asset",
    currentStatus: "in_progress",
  });
  try {
    // in_progress -> approved has no seeded rule row, but should be allowed for admin
    const result = await updateAssetStatusInKanban(TEST_SKU, "approved", "admin");
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.toStatus, "approved");
    console.log("Confirmed admin override works for a normal transition with no matching rule row");

    // Same transition, non-admin role, should still be rejected
    await db.update(assets).set({ currentStatus: "in_progress" }).where(eq(assets.sku, TEST_SKU));
    try {
      await updateAssetStatusInKanban(TEST_SKU, "approved", "artist");
      assert.fail("Non-admin should still be rejected for a transition with no matching rule row");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(/not permitted|forbidden/.test(message), `Expected a rejection message, got: ${message}`);
      console.log("Confirmed non-admin roles are still denied by default:", message);
    }
  } finally {
    await db.delete(assets).where(eq(assets.sku, TEST_SKU));
  }

  // Receipt gate: payment_done requires a payment receipt already attached to the
  // asset, for every role including admin — same structural "can't be bypassed"
  // spirit as the payment gate tested above.
  await db.delete(assets).where(eq(assets.sku, TEST_SKU));
  await db.insert(assets).values({
    sku: TEST_SKU,
    itemName: "Receipt Gate Test Asset",
    currentStatus: "marked_for_payment",
  });
  try {
    // marked_for_payment -> payment_done has a real seeded rule, but no receipt is
    // attached yet, so it should still be rejected — even for admin.
    try {
      await updateAssetStatusInKanban(TEST_SKU, "payment_done", "admin");
      assert.fail("payment_done should be rejected with no receipt attached, even for admin");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(/receipt/i.test(message), `Expected a receipt-related rejection, got: ${message}`);
      console.log("Caught expected rejection of payment_done with no receipt attached:", message);
    }

    // Once a receipt is attached, the same transition succeeds.
    await db.update(assets).set({ paymentReceiptUrl: "https://example.com/receipt.pdf" }).where(eq(assets.sku, TEST_SKU));
    const result = await updateAssetStatusInKanban(TEST_SKU, "payment_done", "admin");
    assert.strictEqual(result.changed, true);
    assert.strictEqual(result.toStatus, "payment_done");
    console.log("Confirmed payment_done succeeds once a payment receipt is attached");
  } finally {
    await db.delete(assets).where(eq(assets.sku, TEST_SKU));
  }

  console.log("✓ All P2-T12/P2-T13/P2-T23 transition enforcement assertions passed cleanly against a live DB!");
}

testTransitionRulesEnforcement()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
