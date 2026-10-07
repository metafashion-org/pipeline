import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { statusHistory } from "@/lib/db/schema/status_history";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { addRobloxLink, canPutOnSale, listNotOnSale, listRobloxLinks, OnSaleError, setLinkOnSale } from "../on-sale-service";

const SKU_PREFIX = "TEST-ONSALE-";
const SKU = `${SKU_PREFIX}HAT`;

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${SKU_PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(statusHistory).where(inArray(statusHistory.assetId, ids));
    await db.delete(uploadRecords).where(inArray(uploadRecords.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
}

async function testOnSale() {
  console.log("Verifying recolours go on sale one by one, and the Marketing list shows what is not on sale yet...");
  await cleanup();
  assert.ok(canPutOnSale(["admin"]) && !canPutOnSale(["operator", "publisher"]), "Only an admin puts things on sale");

  const [asset] = await db.insert(assets).values({ sku: SKU, itemName: "On sale hat", currentStatus: "ready_for_upload" }).returning();
  await assert.rejects(addRobloxLink(SKU, "https://www.roblox.com/catalog/333/Blue-hat", null, null), OnSaleError, "First links go through the Upload queue");

  await db.update(assets).set({ currentStatus: "uploaded_to_roblox" }).where(eq(assets.id, asset.id));
  await db.insert(uploadRecords).values({ assetId: asset.id, robloxAssetId: "111", robloxItemUrl: "https://www.roblox.com/catalog/111/Red-hat" });
  const added = await addRobloxLink(SKU, "https://www.roblox.com/catalog/222/Green-hat?ref=x", " Green ", null);
  assert.strictEqual(added.variantLabel, "Green");
  assert.strictEqual(added.onSaleAt, null, "A new recolour starts off sale");
  await assert.rejects(addRobloxLink(SKU, "https://www.roblox.com/catalog/222/Green-hat", null, null), OnSaleError, "The same item can't be linked twice");
  await assert.rejects(addRobloxLink(SKU, "https://example.com/hat", null, null), OnSaleError, "Only Roblox catalog links");

  const [first, second] = await listRobloxLinks(SKU);
  assert.strictEqual(first.robloxAssetId, "111", "Oldest link first");
  const waiting = (await listNotOnSale()).find((a) => a.sku === SKU);
  assert.strictEqual(waiting?.links.length, 2, "A live asset with nothing on sale is on the Marketing list, with all its links");

  await setLinkOnSale(SKU, second.id, true, null);
  const ticked = await listRobloxLinks(SKU);
  assert.ok(ticked[1].onSaleAt && !ticked[0].onSaleAt, "Only the ticked recolour is on sale");
  assert.ok(!(await listNotOnSale()).some((a) => a.sku === SKU), "One recolour on sale takes it off the list");

  await setLinkOnSale(SKU, second.id, false, null);
  assert.ok((await listNotOnSale()).some((a) => a.sku === SKU), "Taking it off sale puts it back on the list");
  const [still] = await db.select().from(assets).where(eq(assets.id, asset.id));
  assert.strictEqual(still.currentStatus, "uploaded_to_roblox", "Putting on sale never moves the card");
  console.log("Confirmed putting on sale");
}

testOnSale()
  .then(async () => {
    await cleanup();
    console.log("✓ All on-sale assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
