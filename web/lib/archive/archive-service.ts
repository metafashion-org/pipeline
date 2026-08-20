import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { and, eq, lte, or, ilike, sql, desc, type SQL } from "drizzle-orm";

/**
 * How many archived rows a single request will ever load.
 *
 * The archive only grows: every asset that gets paid stays in it forever. Filtering it in the browser meant shipping every row to every visitor, which is fine at tens of rows and is roughly a megabyte and a thousand DOM nodes at a thousand. Searching in SQL and capping the result keeps the page the same size whether the archive holds fifty rows or fifty thousand.
 *
 * When a filter matches more than this, the caller is told the real total so it can say so rather than silently truncating.
 */
export const ARCHIVE_PAGE_SIZE = 100;

/** Assets are archived once they are paid and have settled for this long. */
const ARCHIVE_SETTLE_DAYS = 7;

export interface ArchiveQuery {
  q?: string;
  month?: string;
}

export interface ArchiveRow {
  id: string;
  sku: string;
  title: string;
  assignedTo: string | null;
  feeAmount: string | null;
  currency: string | null;
  paymentReceiptUrl: string | null;
  paidAt: Date | null;
}

export interface ArchiveResult {
  rows: ArchiveRow[];
  total: number;
  months: string[];
  truncated: boolean;
}

/**
 * The moment an asset was actually paid.
 * status_history is the record of that; assets.updatedAt only says when the row was last touched for any reason, so it is a fallback for rows that predate the history table.
 */
const paidAt = sql<Date>`coalesce((
  select max(sh.created_at) from status_history sh
  where sh.asset_id = ${assets.id} and sh.to_status = 'payment_done'
), ${assets.updatedAt})`;

function archiveConditions({ q, month }: ArchiveQuery): SQL[] {
  const settledBefore = new Date();
  settledBefore.setDate(settledBefore.getDate() - ARCHIVE_SETTLE_DAYS);

  const conditions: SQL[] = [
    eq(assets.currentStatus, "payment_done"),
    lte(assets.updatedAt, settledBefore),
  ];

  const trimmed = q?.trim();
  if (trimmed) {
    // ilike is Postgres' case-insensitive LIKE, so the same substring match the browser was doing, done where the data lives.
    const pattern = `%${trimmed.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const match = or(ilike(assets.sku, pattern), ilike(assets.itemName, pattern), ilike(personnel.name, pattern));
    if (match) conditions.push(match);
  }

  if (month) {
    conditions.push(sql`to_char(${paidAt}, 'YYYY-MM') = ${month}`);
  }

  return conditions;
}

/**
 * Reads one capped page of the archive, plus the totals the UI needs to describe it honestly.
 *
 * Input: an optional search string (matched against SKU, item name and artist) and an optional "YYYY-MM" month.
 * Output: up to ARCHIVE_PAGE_SIZE rows newest-paid first, the true number of matches, every month the archive covers, and whether the rows were capped.
 */
export async function getArchivedAssets(query: ArchiveQuery = {}): Promise<ArchiveResult> {
  const conditions = archiveConditions(query);

  const [rows, [{ count }], monthRows] = await Promise.all([
    db
      .select({
        id: assets.id,
        sku: assets.sku,
        title: assets.itemName,
        assignedTo: personnel.name,
        feeAmount: assets.feeAmount,
        currency: assets.currency,
        paymentReceiptUrl: assets.paymentReceiptUrl,
        paidAt: paidAt,
      })
      .from(assets)
      .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
      .where(and(...conditions))
      .orderBy(desc(paidAt))
      .limit(ARCHIVE_PAGE_SIZE),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(assets)
      .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
      .where(and(...conditions)),

    // The month list is built from the whole archive, not the current filter, so choosing a month never removes the other months from the dropdown.
    db
      .select({ month: sql<string>`to_char(${paidAt}, 'YYYY-MM')` })
      .from(assets)
      .where(and(...archiveConditions({})))
      .groupBy(sql`to_char(${paidAt}, 'YYYY-MM')`)
      .orderBy(desc(sql`to_char(${paidAt}, 'YYYY-MM')`)),
  ]);

  return {
    rows,
    total: count,
    months: monthRows.map((m) => m.month).filter(Boolean),
    truncated: count > rows.length,
  };
}

/**
 * Sums what was paid across every row matching the filter, not just the page that was loaded.
 * Kept separate from the row query so the displayed total stays correct once the cap kicks in.
 * Fees are stored per asset in that asset's currency, so this is only meaningful for a single-currency filter; it reports the currencies it summed so the caller can say which.
 */
export async function getArchivedTotal(query: ArchiveQuery = {}): Promise<{ total: number; currencies: string[] }> {
  const rows = await db
    .select({
      currency: sql<string>`coalesce(${assets.currency}, 'USD')`,
      sum: sql<number>`coalesce(sum(${assets.feeAmount}), 0)::float`,
    })
    .from(assets)
    .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
    .where(and(...archiveConditions(query)))
    .groupBy(sql`coalesce(${assets.currency}, 'USD')`);

  return {
    total: rows.reduce((sum, r) => sum + Number(r.sum), 0),
    currencies: rows.map((r) => r.currency),
  };
}
