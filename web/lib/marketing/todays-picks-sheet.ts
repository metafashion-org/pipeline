// The private Today's Picks sheet: the Kanban writes every live SKU and listing into it so Arjun's
// assistant workflow can read them. Stage 1 only writes. Every tab here is the Kanban's and is
// rewritten on each sync, so an edit made in the sheet is overwritten, not read back. Suggestion
// columns the assistant may fill come in a later stage.
//
// The sheet sits at the shared drive's root with no domain-wide grant, shared with Arjun only. The
// service account's drive.file scope reaches only files it made, which is why the Kanban makes it.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { clearSheetRange, createPrivateSheet, readSheetRows, writeSheetCells } from "@/lib/assets/drive-upload";
import { listTodaysPicksPreview, type PreviewItem } from "./todays-picks-service";

const SHEET_SETTING_KEY = "todays_picks_sheet";
const SHEET_NAME = "Meta Fashion — Today's Picks (private)";
// Arjun's work account, the one person the sheet is shared with.
export const TODAYS_PICKS_SHEET_EDITOR = "arjun@metafashion.in";
const ITEMS_TAB = "Items";
const LISTINGS_TAB = "Listings";
const LOG_TAB = "Sync log";
export const ITEMS_HEADER = ["sku", "item_name", "status", "brand_group", "listings", "on_sale", "main_listing_id", "artifacts", "reference_images", "blockers", "synced_at"];
export const LISTINGS_HEADER = [
  "sku",
  "listing_id",
  "roblox_asset_id",
  "url",
  "is_main",
  "colour_label",
  "our_on_sale",
  "our_on_sale_at",
  "roblox_for_sale",
  "roblox_name",
  "roblox_price",
  "roblox_creator",
  "roblox_checked_at",
  "roblox_check_error",
  "thumbnail_url",
  "synced_at",
];
const LOG_HEADER = ["time", "result", "items", "listings", "error"];
// Columns A to P cover the widest tab; rows up to 2000 cover the catalog many times over.
const DATA_RANGE_ROWS = 2000;

export interface TodaysPicksSheetConfig {
  sheetId: string;
  url: string;
  email: string;
}

export interface SheetIo {
  makeSheet: (name: string, tabs: { title: string; header: string[] }[], email: string) => Promise<{ id: string; url: string }>;
  clear: (sheetId: string, range: string) => Promise<void>;
  write: (sheetId: string, startCell: string, rows: string[][]) => Promise<void>;
  read: (sheetId: string, range: string) => Promise<string[][]>;
}

const GOOGLE_IO: SheetIo = { makeSheet: createPrivateSheet, clear: clearSheetRange, write: writeSheetCells, read: readSheetRows };

/** Output: the saved sheet's id and link, or null before the first sync made one. */
export async function getTodaysPicksSheet(): Promise<TodaysPicksSheetConfig | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SHEET_SETTING_KEY)).limit(1);
  const value = row?.value as Partial<TodaysPicksSheetConfig> | undefined;
  return value?.sheetId && value.url && value.email ? (value as TodaysPicksSheetConfig) : null;
}

/** Input: preview items and the sync time. Output: the Items and Listings rows, without headers. */
export function sheetRows(items: PreviewItem[], syncedAt: string): { items: string[][]; listings: string[][] } {
  const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? "" : v ? "yes" : "no");
  return {
    items: items.map((item) => [
      item.sku,
      item.itemName,
      item.status,
      item.brandGroup ?? "",
      String(item.listings.length),
      String(item.listings.filter((l) => l.onSaleAt).length),
      item.listings.find((l) => l.isMain)?.id ?? "",
      item.artifacts.map((a) => `${a.artifactId} ${a.title}`).join("; "),
      String(item.referenceImageCount),
      item.blockers.join("; "),
      syncedAt,
    ]),
    listings: items.flatMap((item) =>
      item.listings.map((l) => [
        item.sku,
        l.id,
        l.robloxAssetId ?? "",
        l.url,
        yesNo(l.isMain),
        l.variantLabel ?? "",
        yesNo(!!l.onSaleAt),
        l.onSaleAt ?? "",
        yesNo(l.lastCheck?.isForSale),
        l.lastCheck?.robloxName ?? "",
        l.lastCheck?.priceRobux === null || l.lastCheck?.priceRobux === undefined ? "" : String(l.lastCheck.priceRobux),
        l.lastCheck?.creatorName ?? "",
        l.lastCheck?.checkedAt ?? "",
        l.lastCheck?.error ?? "",
        l.thumbnailUrl ?? "",
        syncedAt,
      ])
    ),
  };
}

async function appendLog(io: SheetIo, sheetId: string, row: string[]): Promise<void> {
  const existing = await io.read(sheetId, `'${LOG_TAB}'!A1:A${DATA_RANGE_ROWS * 10}`);
  await io.write(sheetId, `'${LOG_TAB}'!A${existing.length + 1}`, [row]);
}

/**
 * Writes every live SKU and listing into the private sheet, making the sheet on the first run.
 * The Items and Listings tabs are cleared and rewritten, keyed by sku and listing_id, and each run
 * adds one row to the Sync log tab.
 *
 * Input: who ran it, and (for tests) the Google calls and the preview. Output: the sheet's link
 * and row counts. Throws when Google refuses; the error is also written to the Sync log when the
 * sheet exists.
 */
export async function syncTodaysPicksSheet(
  actorId: string | null,
  io: SheetIo = GOOGLE_IO,
  loadItems: () => Promise<PreviewItem[]> = listTodaysPicksPreview
): Promise<{ url: string; items: number; listings: number }> {
  let config = await getTodaysPicksSheet();
  if (!config) {
    const sheet = await io.makeSheet(
      SHEET_NAME,
      [
        { title: ITEMS_TAB, header: ITEMS_HEADER },
        { title: LISTINGS_TAB, header: LISTINGS_HEADER },
        { title: LOG_TAB, header: LOG_HEADER },
      ],
      TODAYS_PICKS_SHEET_EDITOR
    );
    config = { sheetId: sheet.id, url: sheet.url, email: TODAYS_PICKS_SHEET_EDITOR };
    // Saved only if no other run saved one first; a second run at the same moment keeps the first sheet.
    const saved = await db
      .insert(appSettings)
      .values({ key: SHEET_SETTING_KEY, value: config, updatedBy: actorId })
      .onConflictDoNothing({ target: appSettings.key })
      .returning({ key: appSettings.key });
    if (saved.length === 0) config = (await getTodaysPicksSheet()) ?? config;
    await db.insert(auditLog).values({ action: "createTodaysPicksSheet", entityType: "todays_picks_sheet", entityId: null, actorId, payload: { sheetId: config.sheetId } });
  }

  const syncedAt = new Date().toISOString();
  try {
    const rows = sheetRows(await loadItems(), syncedAt);
    await io.clear(config.sheetId, `'${ITEMS_TAB}'!A2:P${DATA_RANGE_ROWS}`);
    await io.clear(config.sheetId, `'${LISTINGS_TAB}'!A2:P${DATA_RANGE_ROWS}`);
    if (rows.items.length > 0) await io.write(config.sheetId, `'${ITEMS_TAB}'!A2`, rows.items);
    if (rows.listings.length > 0) await io.write(config.sheetId, `'${LISTINGS_TAB}'!A2`, rows.listings);
    await appendLog(io, config.sheetId, [syncedAt, "ok", String(rows.items.length), String(rows.listings.length), ""]);
    await db.insert(auditLog).values({ action: "syncTodaysPicksSheet", entityType: "todays_picks_sheet", entityId: null, actorId, payload: { items: rows.items.length, listings: rows.listings.length } });
    return { url: config.url, items: rows.items.length, listings: rows.listings.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    await appendLog(io, config.sheetId, [syncedAt, "failed", "", "", message]).catch(() => undefined);
    throw err;
  }
}
