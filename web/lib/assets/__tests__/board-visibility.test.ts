import assert from "node:assert";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { getKanbanBoardData } from "@/lib/kanban/kanban-service";
import { getReadyForUploadQueue } from "@/lib/publisher/publisher-service";
import { AssetNotFoundError, hideAssetFromBoard, listHiddenAssets, putAssetBackOnBoard } from "../board-visibility";

const SKU_OLD = "TEST-BOARD-HIDDEN-OLD";
const SKU_KEPT = "TEST-BOARD-HIDDEN-KEPT";
const ARTIST_EMAIL = "test-board-hidden-artist@example.com";
const ADMIN_EMAIL = "test-board-hidden-admin@example.com";

async function cleanup() {
  const rows = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, [ARTIST_EMAIL, ADMIN_EMAIL]));
  if (rows.length > 0) await db.delete(auditLog).where(inArray(auditLog.actorId, rows.map((r) => r.id)));
  await db.delete(assets).where(inArray(assets.sku, [SKU_OLD, SKU_KEPT]));
  await db.delete(personnel).where(inArray(personnel.email, [ARTIST_EMAIL, ADMIN_EMAIL]));
}

function boardSkus(columns: Awaited<ReturnType<typeof getKanbanBoardData>>["columns"]): string[] {
  return columns.flatMap((col) => col.assets.map((a) => a.sku));
}

async function testHideAndPutBack() {
  console.log("Verifying a hidden card leaves the board, My Tasks and the uploader queue, and Put back returns it...");
  await cleanup();
  const [artist] = await db.insert(personnel).values({ name: "Hidden Card Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  const [admin] = await db.insert(personnel).values({ name: "Hidden Card Admin", email: ADMIN_EMAIL, roles: ["admin"] }).returning();
  await db.insert(assets).values([
    { sku: SKU_OLD, itemName: "Old Imported Belt", currentStatus: "ready_for_upload", currentArtistId: artist.id },
    { sku: SKU_KEPT, itemName: "Current Hat", currentStatus: "in_progress", currentArtistId: artist.id },
  ]);

  await hideAssetFromBoard(SKU_OLD, admin.id);

  const board = boardSkus((await getKanbanBoardData()).columns);
  assert.ok(!board.includes(SKU_OLD), "The hidden card is off the board");
  assert.ok(board.includes(SKU_KEPT), "Other cards stay on the board");
  const myTasks = boardSkus((await getKanbanBoardData(ARTIST_EMAIL)).columns);
  assert.deepStrictEqual(myTasks, [SKU_KEPT], "The artist's My Tasks leaves the hidden card out too");
  const queue = await getReadyForUploadQueue();
  assert.ok(!queue.some((item) => item.sku === SKU_OLD), "A hidden ready-for-upload card is not in the uploader queue");

  const hidden = (await listHiddenAssets()).find((h) => h.sku === SKU_OLD);
  assert.ok(hidden, "The hidden card is on the Hidden cards list");
  assert.strictEqual(hidden.hiddenByName, "Hidden Card Admin");
  assert.strictEqual(hidden.currentStatus, "ready_for_upload", "Hiding keeps the card's status");

  const [hideLog] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "hideAssetFromBoard"), eq(auditLog.actorId, admin.id)));
  assert.ok(hideLog, "Hiding writes an audit_log row");
  console.log("Confirmed the hidden card left every open-work view and was logged");

  await putAssetBackOnBoard(SKU_OLD, admin.id);
  assert.ok(boardSkus((await getKanbanBoardData()).columns).includes(SKU_OLD), "Put back returns the card to the board");
  assert.ok(!(await listHiddenAssets()).some((h) => h.sku === SKU_OLD), "Put back removes it from the Hidden cards list");
  const [putBackLog] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "putAssetBackOnBoard"), eq(auditLog.actorId, admin.id)));
  assert.ok(putBackLog, "Putting a card back writes an audit_log row");
  console.log("Confirmed Put back returns the card and is logged");
}

async function testUnknownSku() {
  console.log("Verifying an unknown SKU raises AssetNotFoundError...");
  await assert.rejects(() => hideAssetFromBoard("TEST-BOARD-HIDDEN-NO-SUCH-SKU", null), AssetNotFoundError);
  console.log("Confirmed an unknown SKU is refused");
}

async function run() {
  await testHideAndPutBack();
  await testUnknownSku();
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All board visibility assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
