import assert from "node:assert";
import { nextSequentialSku } from "../sku";

// The live table holds both SKU shapes at once, which is why the counter has to ignore the ULID ones.
function testSkuGeneration() {
  console.log("Verifying sequential SKU generation...");

  assert.strictEqual(
    nextSequentialSku(["MF-2026-0001", "MF-2026-0037", "MF-2026-0012"], 2026),
    "MF-2026-0038",
    "Must continue from the highest existing number, not the last one seen"
  );

  // ULID-style SKUs coexist in the same column and must not be parsed as numbers.
  assert.strictEqual(
    nextSequentialSku(["MF-2026-0005", "MF-01KG77QS439A83KMM1GS992N27"], 2026),
    "MF-2026-0006",
    "Non-numeric SKUs must be ignored when finding the highest"
  );

  // A different year starts its own sequence rather than continuing the previous one.
  assert.strictEqual(
    nextSequentialSku(["MF-2026-0037"], 2027),
    "MF-2027-0001",
    "A new year starts at 0001"
  );

  assert.strictEqual(nextSequentialSku([], 2026), "MF-2026-0001", "An empty table starts at 0001");

  // Four-digit padding is what every existing SKU uses, and it keeps them sorting lexicographically.
  assert.strictEqual(nextSequentialSku(["MF-2026-0009"], 2026), "MF-2026-0010", "Numbers stay zero-padded to four digits");

  console.log("✓ All sequential SKU assertions passed cleanly!");
}

testSkuGeneration();
process.exit(0);
