import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { marketingUpdates } from "@/lib/db/schema/marketing_updates";
import { nominationDrafts } from "@/lib/db/schema/nomination_drafts";
import { personnel } from "@/lib/db/schema/personnel";
import { robloxListingChecks } from "@/lib/db/schema/roblox_listing_checks";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { MARKETING_TASK_ID } from "../nomination-service";
import { filingPackage, getOwnerDetails, listFilings, markFiled, setOwnerDetails } from "../todays-picks-filing";
import type { PreviewItem, PreviewListing } from "../todays-picks-service";

const PREFIX = "TEST-FILING-";
const OWNER_EMAIL = "test-filing-owner@example.test";

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(marketingUpdates).where(inArray(marketingUpdates.assetId, ids));
    await db.delete(nominationDrafts).where(inArray(nominationDrafts.assetId, ids));
    await db.delete(uploadRecords).where(inArray(uploadRecords.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(appSettings).where(eq(appSettings.key, "todays_picks_owner_details"));
  await db.delete(teamTaskComments).where(eq(teamTaskComments.taskId, MARKETING_TASK_ID));
  await db.delete(teamTasks).where(eq(teamTasks.id, MARKETING_TASK_ID));
  const [owner] = await db.select({ id: personnel.id }).from(personnel).where(eq(personnel.email, OWNER_EMAIL));
  if (owner) await db.delete(auditLog).where(eq(auditLog.actorId, owner.id));
  await db.delete(personnel).where(eq(personnel.email, OWNER_EMAIL));
}

function listing(o: Partial<PreviewListing>): PreviewListing {
  return { id: "m", url: "https://www.roblox.com/catalog/111", robloxAssetId: "111", variantLabel: null, onSaleAt: "x", isMain: true, approvedName: null, thumbnailUrl: null, lastCheck: { checkedAt: "", isForSale: true, priceRobux: 145, robloxName: "Christmas Bow Parasol", creatorName: "UGC Items", assetTypeId: 46, ourOnSale: true, error: null }, ...o };
}

function item(o: Partial<PreviewItem> = {}): PreviewItem {
  return { sku: "X", itemName: "parasol", status: "uploaded_to_roblox", brandGroup: null, artifacts: [], trendReasoning: "Christmas bow parasol trend", nameEvidence: [], approvedName: "Christmas Bow Parasol", referenceImageCount: 0, blockers: [], listings: [listing({})], ...o };
}

function testChecklist() {
  console.log("Verifying the automatic checklist...");
  const ready = filingPackage(item(), { tags: "christmas, parasol" }, null);
  assert.ok(ready.ready, JSON.stringify(ready.checklist));
  assert.strictEqual(ready.fields.item_type, "Accessory / Hair");
  assert.strictEqual(ready.fields.item_link, "https://www.roblox.com/catalog/111");
  const notReady = (o: Partial<PreviewItem>, text: string) => {
    const p = filingPackage(item(o), { tags: "christmas" }, null);
    assert.ok(!p.ready && p.checklist.some((c) => !c.ok && c.label.includes(text)), `${text}: ${JSON.stringify(p.checklist)}`);
  };
  notReady({ approvedName: null }, "Approve a name on the Naming page");
  notReady({ listings: [listing({ isMain: false })] }, "Choose a main listing");
  notReady({ listings: [listing({ lastCheck: { ...listing({}).lastCheck!, isForSale: false } })] }, "off sale");
  notReady({ listings: [listing({ lastCheck: { ...listing({}).lastCheck!, robloxName: "Umbrella-2" } })] }, 'Rename on Roblox: "Umbrella-2" → "Christmas Bow Parasol"');
  const variant = filingPackage(item({ listings: [listing({ approvedName: "Red Christmas Bow Parasol", lastCheck: { ...listing({}).lastCheck!, robloxName: "Red Christmas Bow Parasol" } })] }), { tags: "x" }, null);
  assert.ok(variant.ready && variant.name === "Red Christmas Bow Parasol", "The main listing's own variant name is what Roblox must show");
  console.log("Confirmed checklist");
}

async function testFiling() {
  console.log("Verifying owner details and Mark filed...");
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Filing Owner", email: OWNER_EMAIL, roles: ["admin"] }).returning();
  await db.insert(teamTasks).values({ id: MARKETING_TASK_ID, title: "Marketing company function", area: "marketing", ownerId: owner.id, isPrivate: true });
  assert.ok((await getOwnerDetails()).username, "Has a default username");
  await setOwnerDetails({ username: "new-name", email: "new@example.test" }, owner.id);
  assert.deepStrictEqual(await getOwnerDetails(), { username: "new-name", email: "new@example.test" }, "Changed once, used for every filing");
  await assert.rejects(setOwnerDetails({ username: "x", email: "not-an-email" }, owner.id));

  const [asset] = await db.insert(assets).values({ sku: `${PREFIX}PARASOL`, itemName: "parasol", currentStatus: "uploaded_to_roblox", approvedName: "Christmas Bow Parasol" }).returning();
  const [main] = await db.insert(uploadRecords).values({ assetId: asset.id, robloxAssetId: "8801", robloxItemUrl: "https://www.roblox.com/catalog/8801", onSaleAt: new Date(), mainAt: new Date() }).returning();
  await db.insert(robloxListingChecks).values({ uploadRecordId: main.id, isForSale: true, robloxName: "Christmas Bow Parasol", assetTypeId: 46, ourOnSale: true, httpStatus: 200 });
  const before = (await listFilings()).find((f) => f.sku === asset.sku)!;
  assert.ok(before.ready && !before.filed, JSON.stringify(before.checklist));

  const both = await Promise.all([1, 2].map(() => markFiled(asset.sku, { by: "Instinct", note: "via sheet" }, owner.id)));
  assert.strictEqual(both.filter((r) => !r.alreadyFiled).length, 1, "Two marks record one filing");
  const after = (await listFilings()).find((f) => f.sku === asset.sku)!;
  assert.ok(after.filed && after.filed.by === "Instinct");
  const logged = await db.select().from(marketingUpdates).where(eq(marketingUpdates.assetId, asset.id));
  assert.ok(logged.length === 1 && logged[0].platform === "Roblox Today's Picks" && logged[0].postUrl === "https://www.roblox.com/catalog/8801", "Logged once on the Marketing tracker");
  const comments = await db.select().from(teamTaskComments).where(eq(teamTaskComments.taskId, MARKETING_TASK_ID));
  assert.strictEqual(comments.length, 1);
  assert.strictEqual((await markFiled(asset.sku, { by: "Arjun" }, owner.id)).alreadyFiled, true);
  console.log("Confirmed filing");
}

async function run() {
  testChecklist();
  await testFiling();
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All filing assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
