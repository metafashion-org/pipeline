import assert from "node:assert";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { robloxListingChecks } from "@/lib/db/schema/roblox_listing_checks";
import { appSettings } from "@/lib/db/schema/app_settings";
import { checkSkuOnRoblox, isPlaceholderName, isTodaysPicksOwner, readinessBlockers, setMainListing, TodaysPicksError, type PreviewListing } from "../todays-picks-service";
import { connectTodaysPicksSheet, privacyProblems, sheetRows, SUGGESTIONS_HEADER, EVIDENCE_HEADER, syncTodaysPicksSheet } from "../todays-picks-sheet";
import type { FileAccess, SheetClient } from "../google-sheet-access";

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
  await db.delete(appSettings).where(inArray(appSettings.key, ["todays_picks_sheet", "todays_picks_sheet_lock"]));
  await db.delete(auditLog).where(eq(auditLog.entityType, "todays_picks_sheet"));
}

function listing(overrides: Partial<PreviewListing>): PreviewListing {
  return { id: "x", url: "u", robloxAssetId: "1", variantLabel: "Red", onSaleAt: "2026-10-13T00:00:00Z", isMain: false, thumbnailUrl: null, lastCheck: null, ...overrides };
}

function check(name: string, isForSale: boolean, ourOnSale = true) {
  return { checkedAt: "2026-10-13T00:00:00Z", isForSale, priceRobux: 100, robloxName: name, creatorName: "UGC Items", assetTypeId: 46, ourOnSale, error: null };
}

function testBlockers() {
  console.log("Verifying placeholder names and readiness blockers...");
  for (const name of ["belt 1", "headband_3", "SantaHat 4", "CHRISTMAS 2", "Shades 1", "SantaBag 6"]) assert.ok(isPlaceholderName(name), `${name} is a placeholder`);
  for (const name of ["Red Christmas Reindeer Backpack", "christmas 3.0 snowman body"]) assert.ok(!isPlaceholderName(name), `${name} is a real name`);

  const ready = readinessBlockers({
    artifacts: [{ artifactId: "TR006", title: "Christmas", description: null, tags: [] }],
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
  // Checked through the catalog: a deliberate unique violation upsets the local PGlite stand-in.
  const index = await db.execute(sql`select indexdef from pg_indexes where indexname = 'upload_records_one_main_per_asset_idx'`);
  assert.match(String((index as unknown as { indexdef: string }[])[0]?.indexdef), /UNIQUE.*\(asset_id\).*WHERE \(main_at IS NOT NULL\)/, "The database allows one main listing per asset");
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

const SA = "kanban@project.iam.gserviceaccount.com";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEFG";

type FakeTab = { sheetId: number; title: string; rowCount: number; cells: string[][] };
type FakeRequest = {
  addSheet?: { properties: { title: string } };
  appendDimension?: { sheetId: number; length: number };
  updateCells?: {
    range?: { sheetId: number; startRowIndex: number };
    start?: { sheetId: number; rowIndex: number };
    rows?: { values: { userEnteredValue: { stringValue: string } }[] }[];
  };
};

/** Stands in for Google: keeps each tab's cells and applies a batchUpdate whole or not at all. */
function fakeGoogle() {
  const state = {
    access: {
      ownerEmails: ["arjun@metafashion.in"],
      driveId: null as string | null,
      trashed: false,
      permissions: [
        { type: "user", role: "owner", emailAddress: "arjun@metafashion.in", domain: null },
        { type: "user", role: "writer", emailAddress: SA, domain: null },
      ] as FileAccess["permissions"],
    },
    tabs: [{ sheetId: 0, title: "Sheet1", rowCount: 1000, cells: [] }] as FakeTab[],
    failNextBatch: false,
    batchDelayMs: 0,
    batchCalls: 0,
    log: [] as string[][],
  };
  const client: SheetClient = {
    serviceAccountEmail: () => SA,
    getFileAccess: async () => structuredClone(state.access),
    getTabs: async () => state.tabs.map(({ sheetId, title, rowCount }) => ({ sheetId, title, rowCount })),
    async batchUpdate(_id, requests) {
      state.batchCalls++;
      if (state.batchDelayMs) await new Promise((r) => setTimeout(r, state.batchDelayMs));
      if (state.failNextBatch) {
        state.failNextBatch = false;
        throw new Error("Google answered 500");
      }
      const next = structuredClone(state.tabs);
      const byId = (id: number) => next.find((t) => t.sheetId === id)!;
      for (const req of requests as FakeRequest[]) {
        if (req.addSheet) next.push({ sheetId: Math.max(...next.map((t) => t.sheetId)) + 1, title: req.addSheet.properties.title, rowCount: 1000, cells: [] });
        else if (req.appendDimension) byId(req.appendDimension.sheetId).rowCount += req.appendDimension.length;
        else if (req.updateCells?.range) {
          const tab = byId(req.updateCells.range.sheetId);
          tab.cells = tab.cells.slice(0, req.updateCells.range.startRowIndex);
        } else if (req.updateCells?.start) {
          const { start, rows = [] } = req.updateCells;
          const tab = byId(start.sheetId);
          rows.forEach((row, i) => {
            tab.cells[start.rowIndex + i] = row.values.map((v) => v.userEnteredValue.stringValue);
          });
        }
      }
      state.tabs = next;
    },
    readRows: async (_id, range) => {
      assert.ok(["'Suggestions'!A2:G", "'Evidence'!A2:J"].includes(range), "Only Suggestions and Evidence are read");
      return state.tabs.find((t) => t.title === range.split("'")[1])?.cells.slice(1) ?? [];
    },
    appendRows: async (_id, range, rows) => {
      assert.ok(range.startsWith("'Sync log'"), "Only the log is appended to");
      state.log.push(...rows);
    },
  };
  const tab = (title: string) => state.tabs.find((t) => t.title === title)!;
  return { state, client, tab };
}

function previewOf(count: number) {
  return async () =>
    Array.from({ length: count }, (_, i) => ({
      sku: `${SKU}-${i}`,
      itemName: `Picks item ${i}`,
      status: "uploaded_to_roblox",
      brandGroup: null,
      artifacts: [],
      trendReasoning: null,
      nameEvidence: [],
      referenceImageCount: 0,
      listings: [listing({ id: `L${i}`, lastCheck: check(`Item ${i}`, true) })],
      blockers: ["No main listing chosen"],
    }));
}

function testPrivacyRules() {
  console.log("Verifying the sheet must be Arjun's, in My Drive, shared with nobody else...");
  const base = fakeGoogle().state.access;
  assert.deepStrictEqual(privacyProblems(base, SA), [], "Arjun's My Drive sheet shared only with the service account is private");
  const cases: [string, FileAccess][] = [
    ["shared drive", { ...base, driveId: "0AB" }],
    ["owned by", { ...base, ownerEmails: ["vkydlabs@gmail.com"] }],
    ["everyone at metafashion.in", { ...base, permissions: [...base.permissions, { type: "domain", role: "reader", emailAddress: null, domain: "metafashion.in" }] }],
    ["anyone with the link", { ...base, permissions: [...base.permissions, { type: "anyone", role: "reader", emailAddress: null, domain: null }] }],
    ["jsingh@metafashion.in", { ...base, permissions: [...base.permissions, { type: "user", role: "reader", emailAddress: "jsingh@metafashion.in", domain: null }] }],
    ["Share the sheet with", { ...base, permissions: base.permissions.slice(0, 1) }],
  ];
  for (const [expected, access] of cases) assert.ok(privacyProblems(access, SA).some((p) => p.includes(expected)), `Refused: ${expected}`);
  assert.ok(isTodaysPicksOwner("Arjun@MetaFashion.in") && !isTodaysPicksOwner("vkydlabs@gmail.com") && !isTodaysPicksOwner(undefined), "Only Arjun's account owns the workflow");
  console.log("Confirmed privacy rules");
}

async function testSheet() {
  console.log("Verifying connect, sync, the protected Suggestions tab, failures and overlapping runs...");
  const g = fakeGoogle();
  g.state.access.driveId = "0AB";
  await assert.rejects(connectTodaysPicksSheet(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, null, g.client), TodaysPicksError, "A shared-drive sheet is refused");
  assert.strictEqual(g.state.batchCalls, 0, "Nothing is written to a sheet that failed the check");
  await assert.rejects(syncTodaysPicksSheet(null, g.client, previewOf(1)), /Connect the sheet first/);
  g.state.access.driveId = null;

  await connectTodaysPicksSheet(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`, null, g.client);
  assert.deepStrictEqual(g.tab("Suggestions").cells[0], SUGGESTIONS_HEADER, "Connect adds the Suggestions tab with its header");
  g.tab("Suggestions").cells.push(["X", "L0", "tags", "christmas cozy", "TR006", "Instinct", "2026-10-14"]);
  const suggestionsBefore = structuredClone(g.tab("Suggestions").cells);
  assert.deepStrictEqual(g.tab("Evidence").cells[0], EVIDENCE_HEADER, "Connect adds the Evidence tab with its header");
  g.tab("Evidence").cells.push(["X", "report_line", "ANA007", "line 101", "tactical duty belt", "duty", "high", "", "", "instinct"]);
  const evidenceBefore = structuredClone(g.tab("Evidence").cells);

  await syncTodaysPicksSheet(null, g.client, previewOf(3));
  assert.strictEqual(g.tab("Items").cells.length, 4, "Header and 3 items");
  assert.strictEqual(g.tab("Listings").cells[1][1], "L0", "Listings keyed by listing id");
  await syncTodaysPicksSheet(null, g.client, previewOf(1));
  assert.strictEqual(g.tab("Items").cells.length, 2, "A smaller sync leaves no old rows behind");
  assert.deepStrictEqual(g.tab("Suggestions").cells, suggestionsBefore, "Sync never touches Suggestions");
  assert.deepStrictEqual(g.tab("Evidence").cells, evidenceBefore, "Sync never writes Evidence");

  // A failed write leaves the previous rows whole, logs the failure and frees the lock.
  const itemsBefore = structuredClone(g.tab("Items").cells);
  g.state.failNextBatch = true;
  await assert.rejects(syncTodaysPicksSheet(null, g.client, previewOf(5)), /500/);
  assert.deepStrictEqual(g.tab("Items").cells, itemsBefore, "A failed sync leaves the last good rows");
  assert.strictEqual(g.state.log.at(-1)?.[1], "failed", "The failure is logged");
  await syncTodaysPicksSheet(null, g.client, previewOf(2));
  assert.strictEqual(g.tab("Items").cells.length, 3, "The next sync runs: the lock was released");

  // Two syncs at the same moment: one runs, the other is refused before touching the sheet.
  g.state.batchDelayMs = 200;
  const logBefore = g.state.log.length;
  const results = await Promise.allSettled([syncTodaysPicksSheet(null, g.client, previewOf(4)), syncTodaysPicksSheet(null, g.client, previewOf(6))]);
  g.state.batchDelayMs = 0;
  assert.strictEqual(results.filter((r) => r.status === "fulfilled").length, 1, "Only one overlapping sync runs");
  const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.match(refused.reason.message, /Another sync is running/);
  assert.strictEqual(g.state.log.length, logBefore + 1, "The run that ran logged once; the refused one never touched the sheet");

  // Tabs deleted by hand come back on the next sync, each with its header, and the rest keep their rows.
  g.state.tabs = g.state.tabs.filter((t) => t.title !== "Suggestions" && t.title !== "Items");
  await syncTodaysPicksSheet(null, g.client, previewOf(2));
  assert.deepStrictEqual(g.tab("Suggestions").cells, [SUGGESTIONS_HEADER], "Suggestions is recreated with only its header");
  assert.strictEqual(g.tab("Items").cells.length, 3, "Items is recreated and filled");

  // A lock left by a run that died is taken over once its lease has passed.
  await db.insert(appSettings).values({ key: "todays_picks_sheet_lock", value: "dead-run", updatedAt: new Date(Date.now() - 10 * 60 * 1000) });
  await syncTodaysPicksSheet(null, g.client, previewOf(1));

  // Access added after connecting stops the next sync before anything is written.
  g.state.access.permissions.push({ type: "domain", role: "reader", emailAddress: null, domain: "metafashion.in" });
  const callsBefore = g.state.batchCalls;
  const logCount = g.state.log.length;
  await assert.rejects(syncTodaysPicksSheet(null, g.client, previewOf(1)), /isn't private/);
  assert.ok(g.state.batchCalls === callsBefore && g.state.log.length === logCount, "No write or log row on a sheet that stopped being private");

  const rows = sheetRows(await previewOf(1)(), "T");
  assert.strictEqual(rows.listings[0][6], "yes", "Our tick is written");
  assert.strictEqual(rows.listings[0][8], "yes", "Roblox's answer is written beside it");
  console.log("Confirmed sheet sync");
}

async function run() {
  await cleanup();
  testBlockers();
  const ids = await testMainListing();
  await testCheck(ids);
  testPrivacyRules();
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
