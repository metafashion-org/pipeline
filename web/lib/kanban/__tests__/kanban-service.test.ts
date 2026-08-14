import assert from "node:assert";
import { getKanbanBoardData, updateAssetStatusInKanban } from "../kanban-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { statuses } from "@/lib/db/schema/statuses";
import { asc, eq, inArray } from "drizzle-orm";

const SKU_A = "TEST-KANBAN-BOARD-A"; // seeded artist's own asset, in_progress
const SKU_B = "TEST-KANBAN-BOARD-B"; // a different artist's asset, assigned
const SKU_STALE = "TEST-KANBAN-BOARD-STALE"; // unrecognized status -> unassigned fallback
const ARTIST_EMAIL = "test-kanban-board-artist@example.com";
const OTHER_ARTIST_EMAIL = "test-kanban-board-other-artist@example.com";

async function cleanup() {
  await db.delete(assets).where(inArray(assets.sku, [SKU_A, SKU_B, SKU_STALE]));
  await db.delete(personnel).where(inArray(personnel.email, [ARTIST_EMAIL, OTHER_ARTIST_EMAIL]));
}

async function testUpdateStatusNotFoundSkuThrows() {
  console.log("Verifying updateAssetStatusInKanban() rejects an unknown SKU...");
  try {
    await updateAssetStatusInKanban("NON_EXISTENT_SKU_123", "in_progress");
    assert.fail("Should have thrown for a non-existent SKU");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert.strictEqual(message, "Asset with SKU 'NON_EXISTENT_SKU_123' not found");
    console.log("Caught expected error:", message);
  }
}

async function testColumnsBuiltFromStatusesTableAndArtistFilter() {
  console.log("Verifying getKanbanBoardData() builds columns from the statuses table and artist-email filtering actually filters...");
  await cleanup();

  const [artist] = await db.insert(personnel).values({ name: "Test Kanban Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  const [other] = await db.insert(personnel).values({ name: "Test Kanban Other Artist", email: OTHER_ARTIST_EMAIL, roles: ["artist"] }).returning();

  await db.insert(assets).values({ sku: SKU_A, itemName: "Test Kanban Asset A", currentStatus: "in_progress", currentArtistId: artist.id });
  await db.insert(assets).values({ sku: SKU_B, itemName: "Test Kanban Asset B", currentStatus: "assigned", currentArtistId: other.id });

  try {
    // Columns must be built live from the statuses table, not a hardcoded list.
    const realStatuses = await db.select().from(statuses).orderBy(asc(statuses.sortOrder));
    const { columns } = await getKanbanBoardData();
    assert.deepStrictEqual(
      columns.map((c) => c.key),
      realStatuses.map((s) => s.key),
      "Column keys/order must match the statuses table exactly"
    );
    for (const col of columns) {
      const real = realStatuses.find((s) => s.key === col.key);
      assert.ok(real, `Column '${col.key}' must correspond to a real statuses row`);
      assert.strictEqual(col.label, real.label);
      assert.strictEqual(col.sortOrder, real.sortOrder);
    }

    const colA = columns.find((c) => c.key === "in_progress");
    assert.ok(colA?.assets.some((a) => a.sku === SKU_A), "Seeded asset A must appear in its real status column");
    const colB = columns.find((c) => c.key === "assigned");
    assert.ok(colB?.assets.some((a) => a.sku === SKU_B), "Seeded asset B must appear in its real status column");

    // Artist-email filter: an artist should only see their own assigned assets.
    const { columns: filtered } = await getKanbanBoardData(ARTIST_EMAIL);
    const filteredAssets = filtered.flatMap((c) => c.assets);
    assert.ok(filteredAssets.some((a) => a.sku === SKU_A), "Filtered board must include the filtered artist's own asset");
    assert.ok(!filteredAssets.some((a) => a.sku === SKU_B), "Filtered board must not include another artist's asset");

    // Filter is case-insensitive on email, per the service's own .toLowerCase() comparison.
    const { columns: filteredUpper } = await getKanbanBoardData(ARTIST_EMAIL.toUpperCase());
    const filteredUpperAssets = filteredUpper.flatMap((c) => c.assets);
    assert.ok(filteredUpperAssets.some((a) => a.sku === SKU_A), "Artist-email filter must be case-insensitive");

    console.log("Confirmed columns match the statuses table and artist-email filtering actually filters");
  } finally {
    await cleanup();
  }
}

async function testUnrecognizedStatusFallsBackToUnassigned() {
  console.log("Verifying an asset with an unrecognized/stale status falls back into the 'unassigned' column...");
  await db.delete(assets).where(eq(assets.sku, SKU_STALE));
  await db.insert(assets).values({
    sku: SKU_STALE,
    itemName: "Test Kanban Stale Status Asset",
    currentStatus: "zzz_stale_nonexistent_status",
  });

  try {
    const { columns } = await getKanbanBoardData();
    const unassignedCol = columns.find((c) => c.key === "unassigned");
    assert.ok(unassignedCol, "Board must have an 'unassigned' column to fall back into");
    assert.ok(
      unassignedCol?.assets.some((a) => a.sku === SKU_STALE),
      "Asset with an unrecognized status must fall back into the 'unassigned' column"
    );
    console.log("Confirmed an unrecognized status falls back into 'unassigned'");
  } finally {
    await db.delete(assets).where(eq(assets.sku, SKU_STALE));
  }
}

async function main() {
  await testUpdateStatusNotFoundSkuThrows();
  await testColumnsBuiltFromStatusesTableAndArtistFilter();
  await testUnrecognizedStatusFallsBackToUnassigned();
  console.log("✓ All kanban-service.ts assertions passed cleanly!");
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    await db.delete(assets).where(eq(assets.sku, SKU_STALE)).catch(() => {});
    process.exit(1);
  });
