import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";

/**
 * Everything the admin overview board renders, gathered in one pass.
 *
 * Each panel is a snapshot of the pipeline as it stands, not a time range. That is deliberate: an asset is in exactly one stage right now, so applying a date filter to a stage distribution would produce a chart that looks correct and means nothing. The only time-scoped figures are grouped under `flow`, and they carry the caveat that the history table only covers work that actually moved through the app.
 *
 * Every query runs concurrently. The database is a long way from the server, so the cost of this page is round trips rather than rows.
 */

/** Statuses that mean an artist is actively holding the asset. */
const WIP_STATUSES = ["assigned", "in_progress", "in_review"];
/** Statuses that mean the work is done but the artist has not been paid. */
const OWED_STATUSES = ["marked_for_payment", "uploaded_to_roblox"];

export interface StageCount {
  key: string;
  label: string;
  sortOrder: number;
  count: number;
  oldestDays: number | null;
}

export interface ArtistRow {
  name: string;
  status: string;
  wip: number;
  delivered: number;
  earned: number;
  avgFee: number | null;
}

export interface DashboardData {
  totals: {
    assets: number;
    inProduction: number;
    paidCount: number;
    paidAmount: number;
    owedAmount: number;
    owedCount: number;
    artistsWorking: number;
    avgFee: number | null;
    oldestOwedDays: number | null;
  };
  gaps: {
    noDeadline: number;
    noFee: number;
    paidWithoutReceipt: number;
    paidTotal: number;
    heldByLockedOut: number;
    lockedOutNames: string[];
    unmarketed: number;
    marketingLogged: number;
    overdue: number;
    unassigned: number;
    pendingAccessRequests: number;
  };
  stages: StageCount[];
  artists: ArtistRow[];
  roster: { active: number; inactive: number; blacklisted: number };
  currencies: { currency: string; assets: number; paid: number }[];
  feeSpread: { fee: number; count: number }[];
  flow: {
    byMonth: { month: string; transitions: number; completions: number }[];
    recordedCompletions: number;
    medianCycleDays: number | null;
  };
}

type Row = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybeNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getDashboardData(): Promise<DashboardData> {
  const wip = sql.raw(`'${WIP_STATUSES.join("','")}'`);
  const owed = sql.raw(`'${OWED_STATUSES.join("','")}'`);

  const [
    totalsRows,
    gapRows,
    stageRows,
    artistRows,
    rosterRows,
    currencyRows,
    feeRows,
    monthRows,
    cycleRows,
  ] = await Promise.all([
    db.execute(sql`
      select
        count(*)::int as assets,
        count(*) filter (where current_status in (${wip}))::int as in_production,
        count(*) filter (where current_status = 'payment_done')::int as paid_count,
        coalesce(sum(fee_amount) filter (where current_status = 'payment_done'), 0)::float as paid_amount,
        coalesce(sum(fee_amount) filter (where current_status in (${owed})), 0)::float as owed_amount,
        count(*) filter (where current_status in (${owed}))::int as owed_count,
        count(distinct current_artist_id) filter (where current_status in (${wip}))::int as artists_working,
        round(avg(fee_amount), 0)::float as avg_fee
      from assets
    `),

    db.execute(sql`
      select
        (select count(*) from assets where deadline is null and current_status <> 'payment_done')::int as no_deadline,
        (select count(*) from assets where fee_amount is null)::int as no_fee,
        (select count(*) from assets where current_status = 'payment_done'
           and (payment_receipt_url is null or payment_receipt_url = ''))::int as paid_no_receipt,
        (select count(*) from assets where current_status = 'payment_done')::int as paid_total,
        (select count(*) from assets a join personnel p on p.id = a.current_artist_id
           where p.status <> 'Active' and a.current_status in (${wip}))::int as locked_out_count,
        (select coalesce(string_agg(distinct p.name, '|'), '') from assets a join personnel p on p.id = a.current_artist_id
           where p.status <> 'Active' and a.current_status in (${wip})) as locked_out_names,
        (select count(*) from assets a where a.current_status in ('uploaded_to_roblox','marked_for_payment','payment_done')
           and not exists (select 1 from marketing_updates m where m.asset_id = a.id))::int as unmarketed,
        (select count(*) from marketing_updates)::int as marketing_logged,
        (select count(*) from assets where deadline is not null and deadline < now()
           and current_status not in ('payment_done','marked_for_payment','uploaded_to_roblox'))::int as overdue,
        (select count(*) from assets where current_artist_id is null and current_status <> 'payment_done')::int as unassigned,
        (select count(*) from form_submissions where status = 'pending')::int as pending_access
    `),

    // Stage distribution with the age of the oldest item sitting in each stage.
    db.execute(sql`
      select s.key, s.label, s.sort_order,
             count(a.id)::int as count,
             max(now()::date - (
               select max(sh.created_at)::date from status_history sh
               where sh.asset_id = a.id and sh.to_status = a.current_status
             ))::int as oldest_days
      from statuses s
      left join assets a on a.current_status = s.key
      group by s.key, s.label, s.sort_order
      order by s.sort_order
    `),

    db.execute(sql`
      select p.name, p.status,
             count(*) filter (where a.current_status in (${wip}))::int as wip,
             count(*) filter (where a.current_status = 'payment_done')::int as delivered,
             coalesce(sum(a.fee_amount) filter (where a.current_status = 'payment_done'), 0)::float as earned,
             round(avg(a.fee_amount), 0)::float as avg_fee
      from assets a
      join personnel p on p.id = a.current_artist_id
      group by p.name, p.status
      order by delivered desc, wip desc, p.name
    `),

    db.execute(sql`
      select
        count(*) filter (where status = 'Active')::int as active,
        count(*) filter (where status = 'Inactive')::int as inactive,
        count(*) filter (where status = 'Blacklisted')::int as blacklisted
      from personnel
    `),

    // Money is grouped by currency and never summed across them: adding dollars to rupees produces a number that means nothing.
    db.execute(sql`
      select coalesce(currency, 'USD') as currency,
             count(*)::int as assets,
             coalesce(sum(fee_amount) filter (where current_status = 'payment_done'), 0)::float as paid
      from assets group by coalesce(currency, 'USD') order by assets desc
    `),

    db.execute(sql`
      select fee_amount::float as fee, count(*)::int as count
      from assets where fee_amount is not null
      group by fee_amount order by fee_amount desc
    `),

    db.execute(sql`
      select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
             count(*)::int as transitions,
             count(*) filter (where to_status = 'payment_done')::int as completions
      from status_history group by 1 order by 1
    `),

    // Cycle time only exists for assets that passed through both stages inside the app.
    db.execute(sql`
      select percentile_cont(0.5) within group (order by days)::float as median_days
      from (
        select (max(case when to_status = 'payment_done' then created_at end)::date
              - min(case when to_status = 'assigned' then created_at end)::date) as days
        from status_history group by asset_id
        having max(case when to_status = 'payment_done' then created_at end) is not null
           and min(case when to_status = 'assigned' then created_at end) is not null
      ) t
    `),
  ]);

  const t = (totalsRows as unknown as Row[])[0] || {};
  const g = (gapRows as unknown as Row[])[0] || {};
  const r = (rosterRows as unknown as Row[])[0] || {};
  const c = (cycleRows as unknown as Row[])[0] || {};

  const stages = (stageRows as unknown as Row[]).map((row) => ({
    key: String(row.key),
    label: String(row.label),
    sortOrder: num(row.sort_order),
    count: num(row.count),
    oldestDays: maybeNum(row.oldest_days),
  }));

  const oldestOwed = stages
    .filter((s) => OWED_STATUSES.includes(s.key))
    .map((s) => s.oldestDays)
    .filter((d): d is number => d !== null);

  const lockedNames = String(g.locked_out_names || "").split("|").filter(Boolean);

  return {
    totals: {
      assets: num(t.assets),
      inProduction: num(t.in_production),
      paidCount: num(t.paid_count),
      paidAmount: num(t.paid_amount),
      owedAmount: num(t.owed_amount),
      owedCount: num(t.owed_count),
      artistsWorking: num(t.artists_working),
      avgFee: maybeNum(t.avg_fee),
      oldestOwedDays: oldestOwed.length ? Math.max(...oldestOwed) : null,
    },
    gaps: {
      noDeadline: num(g.no_deadline),
      noFee: num(g.no_fee),
      paidWithoutReceipt: num(g.paid_no_receipt),
      paidTotal: num(g.paid_total),
      heldByLockedOut: num(g.locked_out_count),
      lockedOutNames: lockedNames,
      unmarketed: num(g.unmarketed),
      marketingLogged: num(g.marketing_logged),
      overdue: num(g.overdue),
      unassigned: num(g.unassigned),
      pendingAccessRequests: num(g.pending_access),
    },
    stages,
    artists: (artistRows as unknown as Row[]).map((row) => ({
      name: String(row.name),
      status: String(row.status),
      wip: num(row.wip),
      delivered: num(row.delivered),
      earned: num(row.earned),
      avgFee: maybeNum(row.avg_fee),
    })),
    roster: { active: num(r.active), inactive: num(r.inactive), blacklisted: num(r.blacklisted) },
    currencies: (currencyRows as unknown as Row[]).map((row) => ({
      currency: String(row.currency),
      assets: num(row.assets),
      paid: num(row.paid),
    })),
    feeSpread: (feeRows as unknown as Row[]).map((row) => ({ fee: num(row.fee), count: num(row.count) })),
    flow: {
      byMonth: (monthRows as unknown as Row[]).map((row) => ({
        month: String(row.month),
        transitions: num(row.transitions),
        completions: num(row.completions),
      })),
      recordedCompletions: (monthRows as unknown as Row[]).reduce((sum, row) => sum + num(row.completions), 0),
      medianCycleDays: maybeNum(c.median_days),
    },
  };
}
