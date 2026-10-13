import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { robloxListingChecks } from "@/lib/db/schema/roblox_listing_checks";
import { appSettings } from "@/lib/db/schema/app_settings";
import { checkSkuOnRoblox, isPlaceholderName, readinessBlockers, setMainListing, TodaysPicksError, type PreviewListing } from "../todays-picks-service";
import { sheetRows, syncTodaysPicksSheet, type SheetIo } from "../todays-picks-sheet";

const SKU_PREFIX = "TEST-PICKS-";
const SKU = `${SKU_PREFIX}HAT`;
const OTHER_SKU = `${SKU_PREFIX}BAG`;

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${SKU_PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(uploadRecords).where(inArray(uploadRecords.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(appSettings).where(eq(appSettings.key, "todays_picks_sheet"));
  await db.delete(auditLog).where(eq(auditLog.entityType, "todays_picks_sheet"));
}

function listing(overrides: Partial<PreviewListing>): PreviewListing {
  return { id: "x", url: "u", robloxAssetId: "1", variantLabel: "Red", onSaleAt: "2026-10-13T00:00:00Z", isMain: false, thumbnailUrl: null, lastCheck: null, ...overrides };
}

function check(name: string, isForSale: boolean, ourOnSale = true) {
  return { checkedAt: "2026-10-13T00:00:00Z", isForSale, priceRobux: 100, robloxName: name, creatorName: "UGC Items", ourOnSale, error: null };
}

function testBlockers() {
  console.log("Verifying placeholder names and readiness blockers...");
  for (const name of ["belt 1", "headband_3", "SantaHat 4", "CHRISTMAS 2", "Shades 1", "SantaBag 6"]) assert.ok(isPlaceholderName(name), `${name} is a placeholder`);
  for (const name of ["Red Christmas Reindeer Backpack", "christmas 3.0 snowman body"]) assert.ok(!isPlaceholderName(name), `${name} is a real name`);

  const ready = readinessBlockers({
    artifacts: [{ artifactId: "TR006", title: "Christmas" }],
    listings: [listing({ id: "a", isMain: true, lastCheck: check("Red Bow Parasol", true) }), listing({ id: "b", variantLabel: "Blue", lastCheck: check("Blue Bow Parasol", true) })],
  });
  assert.deepStrictEqual(ready, [], "A checked, labelled, distinctly named family with a main listing and artifacts has no blockers");

  const blocked = readinessBlockers({
    artifacts: [],
    listings: [
      listing({ id: "a", variantLabel: null, onSaleAt: null, lastCheck: check("belt 1", false, false) }),
      listing({ id: "b", variantLabel: null, onSaleAt: null, lastCheck: check("belt 1", true, false) }),
      listing({ id: "c", variantLabel: null, onSaleAt: null }),
    ],
  });
  for (const expected of ["No main listing chosen", "No listing ticked on sale", "No linked artifacts", "1 of 3 listings not checked", "disagree on 1 listings", "Placeholder Roblox names", "listings share one Roblox name", "3 recolours have no colour label"]) {
    assert.ok(blocked.some((b) => b.includes(expected)), `Blocked by: ${expected}`);
  }
  console.log("Confirmed blockers");
}

async function testMainListing() {
  console.log("Verifying one main listing per SKU...");
  const [asset] = await db.insert(assets).values({ sku: SKU, itemName: "Picks hat", currentStatus: "uploaded_to_roblox" }).returning();
  const [other] = await db.insert(assets).values({ sku: OTHER_SKU, itemName: "Picks bag", currentStatus: "payment_done" }).returning();
  const [red, blue] = await db
    .insert(uploadRecords)
    .values([
      { assetId: asset.id, robloxAssetId: "901", robloxItemUrl: "https://www.roblox.com/catalog/901/Red", onSaleAt: new Date() },
      { assetId: asset.id, robloxAssetId: "902", robloxItemUrl: "https://www.roblox.com/catalog/902/Blue" },
    ])
    .returning();
  const [bag] = await db.insert(uploadRecords).values({ assetId: other.id, robloxAssetId: "903", robloxItemUrl: "https://www.roblox.com/catalog/903/Bag" }).returning();

  await setMainListing(SKU, red.id, null);
  await setMainListing(SKU, blue.id, null);
  const mains = await db.select().from(uploadRecords).where(eq(uploadRecords.assetId, asset.id));
  assert.deepStrictEqual(mains.filter((l) => l.mainAt).map((l) => l.id), [blue.id], "Picking another listing moves the main flag");
  await assert.rejects(setMainListing(SKU, bag.id, null), TodaysPicksError, "Another SKU's listing can't be this SKU's main");
  await assert.rejects(db.update(uploadRecords).set({ mainAt: new Date() }).where(eq(uploadRecords.id, red.id)), "The database allows one main listing per asset");
  await setMainListing(SKU, null, null);
  const cleared = await db.select().from(uploadRecords).where(eq(uploadRecords.assetId, asset.id));
  assert.ok(cleared.every((l) => !l.mainAt), "Clearing leaves no main listing");
  console.log("Confirmed main listing");
  return { red, blue };
}

async function testCheck(ids: { red: { id: string }; blue: { id: string } }) {
  console.log("Verifying Roblox checks store both values and stop on 429...");
  const fakeFetch = (async (url: string) => {
    const id = url.split("/").at(-2);
    return new Response(JSON.stringify({ Name: `Listing ${id}`, IsForSale: id === "902", PriceInRobux: 145, AssetTypeId: 46, Creator: { Name: "UGC Items" } }), { status: 200 });
  }) as typeof fetch;
  const noWait = async () => undefined;
  const result = await checkSkuOnRoblox(SKU, null, fakeFetch, noWait);
  assert.deepStrictEqual(result, { checked: 2, failed: 0, stoppedEarly: false });
  const rows = await db.select().from(robloxListingChecks).where(inArray(robloxListingChecks.uploadRecordId, [ids.red.id, ids.blue.id]));
  const red = rows.find((r) => r.uploadRecordId === ids.red.id);
  const blue = rows.find((r) => r.uploadRecordId === ids.blue.id);
  assert.ok(red?.ourOnSale === true && red.isForSale === false, "Red: ticked by us, off sale on Roblox, both kept");
  assert.ok(blue?.ourOnSale === false && blue.isForSale === true, "Blue: not ticked, on sale on Roblox, both kept");
  const [stillRed] = await db.select().from(uploadRecords).where(eq(uploadRecords.id, ids.red.id));
  assert.ok(stillRed.onSaleAt, "A check never changes our tick");

  const limited = (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch;
  const stopped = await checkSkuOnRoblox(SKU, null, limited, noWait);
  assert.deepStrictEqual(stopped, { checked: 0, failed: 1, stoppedEarly: true }, "HTTP 429 stops the check after the first listing");
  console.log("Confirmed checks");
}

async function testSheet() {
  console.log("Verifying the private sheet is made once and rewritten by id...");
  const writes: { range: string; rows: string[][] }[] = [];
  const clears: string[] = [];
  let made = 0;
  let logRows = 1;
  const io: SheetIo = {
    makeSheet: async (_name, tabs, email) => {
      made++;
      assert.strictEqual(email, "arjun@metafashion.in", "Shared with Arjun only");
      assert.deepStrictEqual(tabs.map((t) => t.title), ["Items", "Listings", "Sync log"]);
      return { id: "sheet-1", url: "https://docs.google.com/spreadsheets/d/sheet-1/edit" };
    },
    clear: async (_id, range) => void clears.push(range),
    write: async (_id, range, rows) => {
      writes.push({ range, rows });
      if (range.startsWith("'Sync log'")) logRows++;
    },
    read: async () => Array.from({ length: logRows }, () => ["x"]),
  };
  const items = async () => [
    {
      sku: SKU,
      itemName: "Picks hat",
      status: "uploaded_to_roblox",
      brandGroup: null,
      artifacts: [],
      referenceImageCount: 0,
      listings: [listing({ id: "L1", lastCheck: check("Red hat", true) })],
      blockers: ["No main listing chosen"],
    },
  ];
  const first = await syncTodaysPicksSheet(null, io, items);
  const second = await syncTodaysPicksSheet(null, io, items);
  assert.strictEqual(made, 1, "The sheet is made on the first sync only");
  assert.strictEqual(first.url, second.url);
  assert.strictEqual(clears.length, 4, "Items and Listings are cleared before each rewrite");
  const logs = writes.filter((w) => w.range.startsWith("'Sync log'"));
  assert.deepStrictEqual(logs.map((w) => w.range), ["'Sync log'!A2", "'Sync log'!A3"], "Each sync appends one log row below the last");

  const rows = sheetRows(await items(), "T");
  assert.strictEqual(rows.listings[0][1], "L1", "Listings are keyed by listing id");
  assert.strictEqual(rows.listings[0][6], "yes", "Our tick is written");
  assert.strictEqual(rows.listings[0][8], "yes", "Roblox's answer is written beside it");
  console.log("Confirmed sheet sync");
}

async function run() {
  await cleanup();
  testBlockers();
  const ids = await testMainListing();
  await testCheck(ids);
  await testSheet();
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All Today's Picks assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
