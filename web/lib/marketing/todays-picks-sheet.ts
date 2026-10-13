// The private Today's Picks sheet: Arjun's own Google Sheet in his My Drive, shared only with the
// Kanban's service account. The Kanban writes every live SKU and listing into it for Arjun's
// assistant workflow.
//
// Privacy: before connecting and before every sync the Kanban reads the file's owner, shared drive
// and permissions, and refuses to write unless Arjun owns it in My Drive and nobody but Arjun and
// the service account has access. A file in a shared drive is refused, because every member of
// the drive can open it.
//
// Tabs:
// - Items, Listings: the Kanban's. Each sync replaces their rows in one spreadsheets.batchUpdate,
//   which Google applies whole or not at all, so a failed sync leaves the previous rows in place.
// - Suggestions: for the assistant's suggestions. The Kanban never writes, clears or reads it in
//   this stage, and nothing in it can change a nomination.
// - Sync log: one appended row per sync attempt, ok or failed.
// One sync runs at a time (a lease in app_settings); a second one at the same moment is refused.

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { GOOGLE_SHEET_CLIENT, type FileAccess, type SheetClient, type SheetRequest, type SheetTab } from "./google-sheet-access";
import { listTodaysPicksPreview, TODAYS_PICKS_OWNER_EMAIL, TodaysPicksError, type PreviewItem } from "./todays-picks-service";

const SHEET_SETTING_KEY = "todays_picks_sheet";
const LOCK_SETTING_KEY = "todays_picks_sheet_lock";
// A sync takes a few seconds; a lock older than this belongs to a run that died, and is taken over.
const LOCK_LEASE_MS = 2 * 60 * 1000;
export const ITEMS_TAB = "Items";
export const LISTINGS_TAB = "Listings";
export const SUGGESTIONS_TAB = "Suggestions";
export const LOG_TAB = "Sync log";
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
export const SUGGESTIONS_HEADER = ["sku", "listing_id", "field", "suggested_value", "evidence", "suggested_by", "suggested_at"];
const LOG_HEADER = ["time", "result", "items", "listings", "error"];
const TABS = [
  { title: ITEMS_TAB, header: ITEMS_HEADER },
  { title: LISTINGS_TAB, header: LISTINGS_HEADER },
  { title: SUGGESTIONS_TAB, header: SUGGESTIONS_HEADER },
  { title: LOG_TAB, header: LOG_HEADER },
];
// Google Sheets ids are 44 characters of letters, digits, - and _.
const SHEET_ID_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

export interface TodaysPicksSheetConfig {
  sheetId: string;
  url: string;
}

/** Output: the connected sheet's id and link, or null before Arjun connects one. */
export async function getTodaysPicksSheet(): Promise<TodaysPicksSheetConfig | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SHEET_SETTING_KEY)).limit(1);
  const value = row?.value as Partial<TodaysPicksSheetConfig> | undefined;
  return value?.sheetId && value.url ? { sheetId: value.sheetId, url: value.url } : null;
}

/** Input: a Google Sheets link or a bare id. Output: the id, or null when it isn't one. */
export function parseSheetId(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  const id = fromUrl ?? trimmed;
  return SHEET_ID_PATTERN.test(id) ? id : null;
}

/**
 * Why the sheet isn't private enough to write to. Empty means Arjun owns it in his My Drive and
 * only he and the service account have access.
 *
 * Input: the file's access as Google reports it, and the service account's email. Output: one
 * sentence per problem.
 */
export function privacyProblems(access: FileAccess, serviceAccountEmail: string): string[] {
  const problems: string[] = [];
  const allowed = new Set([TODAYS_PICKS_OWNER_EMAIL, serviceAccountEmail.toLowerCase()]);
  if (access.trashed) problems.push("The sheet is in the trash");
  if (access.driveId) problems.push("The sheet is in a shared drive, so every member of that drive can open it. Keep it in arjun@metafashion.in's My Drive");
  if (access.ownerEmails.length !== 1 || access.ownerEmails[0] !== TODAYS_PICKS_OWNER_EMAIL) problems.push(`The sheet must be owned by ${TODAYS_PICKS_OWNER_EMAIL}`);
  if (!access.permissions.some((p) => p.type === "user" && p.emailAddress === serviceAccountEmail.toLowerCase())) problems.push(`Share the sheet with ${serviceAccountEmail} as an editor`);
  for (const p of access.permissions) {
    if (p.type === "user" && p.emailAddress && allowed.has(p.emailAddress)) continue;
    const who = p.type === "anyone" ? "anyone with the link" : p.type === "domain" ? `everyone at ${p.domain}` : (p.emailAddress ?? p.type);
    problems.push(`Remove access for ${who} (${p.role})`);
  }
  return problems;
}

async function assertPrivate(google: SheetClient, sheetId: string): Promise<void> {
  const problems = privacyProblems(await google.getFileAccess(sheetId), google.serviceAccountEmail());
  if (problems.length > 0) throw new TodaysPicksError(`Not syncing: the sheet isn't private. ${problems.join(". ")}.`);
}

function textRow(cells: string[]) {
  return { values: cells.map((cell) => ({ userEnteredValue: { stringValue: cell } })) };
}

// Adds missing tabs, then writes the header row of every tab the Kanban just added. An existing
// tab's contents, Suggestions included, are left as they are.
async function ensureTabs(google: SheetClient, sheetId: string): Promise<SheetTab[]> {
  const existing = await google.getTabs(sheetId);
  const missing = TABS.filter((tab) => !existing.some((e) => e.title === tab.title));
  if (missing.length === 0) return existing;
  await google.batchUpdate(sheetId, missing.map((tab) => ({ addSheet: { properties: { title: tab.title } } })));
  const tabs = await google.getTabs(sheetId);
  await google.batchUpdate(
    sheetId,
    missing.map((tab) => {
      const added = tabs.find((t) => t.title === tab.title)!;
      return { updateCells: { start: { sheetId: added.sheetId, rowIndex: 0, columnIndex: 0 }, rows: [textRow(tab.header)], fields: "userEnteredValue" } };
    })
  );
  return tabs;
}

/**
 * Connects Arjun's sheet: checks it's private, adds any missing tabs, and saves it.
 *
 * Input: the sheet's link or id, who connected it, and (for tests) the Google client. Output: the
 * saved config. Throws TodaysPicksError for a bad link or a sheet that isn't private.
 */
export async function connectTodaysPicksSheet(input: string, actorId: string | null, google: SheetClient = GOOGLE_SHEET_CLIENT): Promise<TodaysPicksSheetConfig> {
  const sheetId = parseSheetId(input);
  if (!sheetId) throw new TodaysPicksError("That isn't a Google Sheets link");
  await assertPrivate(google, sheetId);
  await ensureTabs(google, sheetId);
  const config = { sheetId, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` };
  await db
    .insert(appSettings)
    .values({ key: SHEET_SETTING_KEY, value: config, updatedBy: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: config, updatedBy: actorId, updatedAt: new Date() } });
  await db.insert(auditLog).values({ action: "connectTodaysPicksSheet", entityType: "todays_picks_sheet", entityId: null, actorId, payload: { sheetId } });
  return config;
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

/**
 * The requests that replace one Kanban tab's data rows: grow the grid if needed, clear every row
 * under the header, then write the new rows. They go out inside the sync's single batchUpdate.
 */
export function replaceRowsRequests(tab: SheetTab, rows: string[][]): SheetRequest[] {
  const neededRows = rows.length + 1;
  const requests: SheetRequest[] = [];
  if (neededRows > tab.rowCount) requests.push({ appendDimension: { sheetId: tab.sheetId, dimension: "ROWS", length: neededRows - tab.rowCount } });
  // updateCells with a range and no rows clears those fields in the range.
  requests.push({ updateCells: { range: { sheetId: tab.sheetId, startRowIndex: 1 }, fields: "userEnteredValue" } });
  if (rows.length > 0) requests.push({ updateCells: { start: { sheetId: tab.sheetId, rowIndex: 1, columnIndex: 0 }, rows: rows.map(textRow), fields: "userEnteredValue" } });
  return requests;
}

// Takes the sync lock unless another run holds a lease younger than LOCK_LEASE_MS. One statement,
// so two runs at the same moment can't both take it.
async function claimLock(token: string, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - LOCK_LEASE_MS);
  const claimed = await db
    .insert(appSettings)
    .values({ key: LOCK_SETTING_KEY, value: token, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: token, updatedAt: now }, setWhere: sql`${appSettings.updatedAt} < ${staleBefore.toISOString()}` })
    .returning({ key: appSettings.key });
  return claimed.length > 0;
}

// Releases only this run's lock, so a run that outlived its lease can't free a newer run's lock.
async function releaseLock(token: string): Promise<void> {
  await db.delete(appSettings).where(and(eq(appSettings.key, LOCK_SETTING_KEY), sql`${appSettings.value} = ${JSON.stringify(token)}::jsonb`));
}

/**
 * Writes every live SKU and listing into the connected sheet. Refuses when the sheet isn't private
 * or another sync is running. Each attempt that gets the lock adds one row to Sync log.
 *
 * Input: who ran it, and (for tests) the Google client and the preview. Output: the sheet's link
 * and row counts. Throws TodaysPicksError for a refusal and Google's error for a failed write.
 */
export async function syncTodaysPicksSheet(
  actorId: string | null,
  google: SheetClient = GOOGLE_SHEET_CLIENT,
  loadItems: () => Promise<PreviewItem[]> = listTodaysPicksPreview
): Promise<{ url: string; items: number; listings: number }> {
  const config = await getTodaysPicksSheet();
  if (!config) throw new TodaysPicksError("Connect the sheet first");
  const token = randomUUID();
  if (!(await claimLock(token, new Date()))) throw new TodaysPicksError("Another sync is running. Try again in a minute");

  const syncedAt = new Date().toISOString();
  // Nothing is written to the sheet, not even a log row, until it has passed the privacy check.
  let isPrivate = false;
  try {
    await assertPrivate(google, config.sheetId);
    isPrivate = true;
    const tabs = await ensureTabs(google, config.sheetId);
    const tab = (title: string) => tabs.find((t) => t.title === title)!;
    const rows = sheetRows(await loadItems(), syncedAt);
    await google.batchUpdate(config.sheetId, [...replaceRowsRequests(tab(ITEMS_TAB), rows.items), ...replaceRowsRequests(tab(LISTINGS_TAB), rows.listings)]);
    await google.appendRows(config.sheetId, `'${LOG_TAB}'!A:E`, [[syncedAt, "ok", String(rows.items.length), String(rows.listings.length), ""]]);
    await db.insert(auditLog).values({ action: "syncTodaysPicksSheet", entityType: "todays_picks_sheet", entityId: null, actorId, payload: { items: rows.items.length, listings: rows.listings.length } });
    return { url: config.url, items: rows.items.length, listings: rows.listings.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    if (isPrivate) await google.appendRows(config.sheetId, `'${LOG_TAB}'!A:E`, [[syncedAt, "failed", "", "", message]]).catch(() => undefined);
    await db.insert(auditLog).values({ action: "syncTodaysPicksSheetFailed", entityType: "todays_picks_sheet", entityId: null, actorId, payload: { error: message } });
    throw err;
  } finally {
    await releaseLock(token);
  }
}
