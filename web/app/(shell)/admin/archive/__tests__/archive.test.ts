import assert from "node:assert";
import { getArchivedAssets, getArchivedTotal } from "@/lib/archive/archive-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { inArray } from "drizzle-orm";

// This used to read app/admin/archive/page.tsx as text and assert it contained the substrings
// "payment_done" and "from(assets)". That proved nothing about behaviour and broke twice for
// reasons that were not bugs: once when the page moved under the (shell) route group, and again
// when the query moved into lib/archive/archive-service.ts, which is where it belongs. A test
// that fails on refactors and passes on wrong output is worse than no test.
//
// It now asserts what the archive is actually for: only paid, settled assets appear in it.

const SKU_PAID_SETTLED = "TEST-ARCHIVE-PAID-SETTLED";
const SKU_PAID_RECENT = "TEST-ARCHIVE-PAID-RECENT";
const SKU_UNPAID = "TEST-ARCHIVE-UNPAID";
const ALL = [SKU_PAID_SETTLED, SKU_PAID_RECENT, SKU_UNPAID];

// Assets are archived once they are paid AND have settled for a week, so "paid yesterday" must
// not show up yet. Dated well past that window to stay clear of the boundary.
const LONG_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

async function cleanup() {
  await db.delete(assets).where(inArray(assets.sku, ALL));
}

async function testOnlyPaidSettledAssetsAreArchived() {
  console.log("Verifying the archive contains only paid, settled assets...");
  await cleanup();

  await db.insert(assets).values([
    { sku: SKU_PAID_SETTLED, itemName: "Archive Paid Settled", currentStatus: "payment_done", updatedAt: LONG_AGO, feeAmount: "100.00", currency: "INR" },
    { sku: SKU_PAID_RECENT, itemName: "Archive Paid Recent", currentStatus: "payment_done", updatedAt: new Date(), feeAmount: "200.00", currency: "INR" },
    { sku: SKU_UNPAID, itemName: "Archive Unpaid", currentStatus: "in_progress", updatedAt: LONG_AGO, feeAmount: "300.00", currency: "INR" },
  ]);

  try {
    const { rows } = await getArchivedAssets();
    const skus = rows.map((r) => r.sku);

    assert.ok(skus.includes(SKU_PAID_SETTLED), "a paid, settled asset must appear in the archive");
    assert.ok(!skus.includes(SKU_PAID_RECENT), "an asset paid just now has not settled yet and must not appear");
    assert.ok(!skus.includes(SKU_UNPAID), "an unpaid asset must never appear in the archive");

    // The search filter runs in SQL against SKU, item name and artist name.
    const { rows: searched } = await getArchivedAssets({ q: "Archive Paid Settled" });
    assert.ok(
      searched.some((r) => r.sku === SKU_PAID_SETTLED),
      "searching by item name must find the archived asset"
    );
    assert.ok(
      !searched.some((r) => r.sku === SKU_UNPAID),
      "the search filter must not widen the archive's status condition"
    );

    // The totals the page reports are computed over the same condition, per currency.
    const { currencies } = await getArchivedTotal();
    assert.ok(Array.isArray(currencies), "archived totals must come back grouped by currency");

    console.log("✓ Archive behaviour assertions passed cleanly against a live DB!");
  } finally {
    await cleanup();
  }
}

testOnlyPaidSettledAssetsAreArchived()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
