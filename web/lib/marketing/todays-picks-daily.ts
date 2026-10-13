// Today's Picks daily automation (stage 4): a once-a-day anonymous check of every live listing on
// Roblox, and an end-of-day marketing email to three people. Both are off until Arjun turns them on
// from the Today's Picks page. The cron route (app/api/cron/todays-picks) runs once a day at 13:30
// UTC, 19:00 in India (web/vercel.json).
//
// The check never changes our on-sale ticks; it records what Roblox shows. The email only reports
// what the Kanban recorded: a "filed" nomination is Arjun's own confirmation, and a nomination is a
// request to Roblox, not a feature.

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { assets } from "@/lib/db/schema/assets";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { nominationDrafts, nominationEvents, type NominationApprovals } from "@/lib/db/schema/nomination_drafts";
import { renderEmailLayout, EMAIL_TONE, type EmailDetailRow } from "@/lib/email/templates/email-layout";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { appUrl } from "@/lib/app-url";
import { teamDay, teamDayBounds } from "@/lib/team-tasks/task-rules";
import { checkSkuOnRoblox, listTodaysPicksPreview, type PreviewItem } from "./todays-picks-service";
import { draftProblems, type DraftProblem } from "./nomination-service";
import type { DraftFields } from "./nomination-fields";

const SETTINGS_KEY = "todays_picks_daily";
const LAST_CHECK_KEY = "todays_picks_daily_last_check";
const LAST_EMAIL_KEY = "todays_picks_daily_last_email";
// The marketing email's audience, set by Arjun. Not the whole team and not the whole domain.
export const MARKETING_EMAIL_RECIPIENTS = ["jsingh@metafashion.in", "ajohri@metafashion.in", "arjun@metafashion.in"];
// After this many failed daily checks in a row the check turns itself off until Arjun turns it back on.
const MAX_FAILED_CHECK_RUNS = 3;
// A run counts as failed when Roblox stopped it (HTTP 429) or more than this share of listings failed.
const MAX_FAILED_LISTING_SHARE = 0.5;

export interface DailySettings {
  checkEnabled: boolean;
  emailEnabled: boolean;
  failedCheckRuns: number;
  lastCheck: { day: string; checked: number; failed: number; stoppedEarly: boolean } | null;
}

const DEFAULT_SETTINGS: DailySettings = { checkEnabled: false, emailEnabled: false, failedCheckRuns: 0, lastCheck: null };

/** Output: the switches and the last check's result. Both switches are off until Arjun turns them on. */
export async function getDailySettings(): Promise<DailySettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<DailySettings>) ?? {}) };
}

async function saveSettings(settings: DailySettings, actorId: string | null): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value: settings, updatedBy: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: settings, updatedBy: actorId, updatedAt: new Date() } });
}

/** Turns the daily check or email on or off. Turning the check on clears its failure count. */
export async function setDailySwitches(input: { checkEnabled?: boolean; emailEnabled?: boolean }, actorId: string | null): Promise<DailySettings> {
  const current = await getDailySettings();
  const next: DailySettings = {
    ...current,
    ...(input.checkEnabled !== undefined ? { checkEnabled: input.checkEnabled, failedCheckRuns: input.checkEnabled ? 0 : current.failedCheckRuns } : {}),
    ...(input.emailEnabled !== undefined ? { emailEnabled: input.emailEnabled } : {}),
  };
  await saveSettings(next, actorId);
  await db.insert(auditLog).values({ action: "setTodaysPicksDaily", entityType: "todays_picks_daily", entityId: null, actorId, payload: input });
  return next;
}

// Claims today's run of one job: true for the first caller of the day, false after. One statement,
// so a retried or doubled cron call can't run a job twice.
async function claimDay(key: string, day: string): Promise<boolean> {
  const claimed = await db
    .insert(appSettings)
    .values({ key, value: day, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: day, updatedAt: new Date() }, setWhere: sql`${appSettings.value} <> ${JSON.stringify(day)}::jsonb` })
    .returning({ key: appSettings.key });
  return claimed.length > 0;
}

/**
 * Checks every live listing on Roblox once today, one SKU after another at one request per second.
 * Stops at Roblox's first HTTP 429. Three failed runs in a row turn the check off.
 *
 * Input: now, and (for tests) the per-SKU checker. Output: what happened, or why it didn't run.
 */
export async function runDailyCheck(
  now: Date,
  checkSku: (sku: string) => Promise<{ checked: number; failed: number; stoppedEarly: boolean }> = (sku) => checkSkuOnRoblox(sku, null)
): Promise<{ ran: boolean; reason?: string; checked?: number; failed?: number; stoppedEarly?: boolean }> {
  const settings = await getDailySettings();
  if (!settings.checkEnabled) return { ran: false, reason: "daily check is off" };
  const day = teamDay(now);
  if (!(await claimDay(LAST_CHECK_KEY, day))) return { ran: false, reason: "already ran today" };

  const items = await listTodaysPicksPreview();
  const total = { checked: 0, failed: 0, stoppedEarly: false };
  for (const item of items) {
    const result = await checkSku(item.sku);
    total.checked += result.checked;
    total.failed += result.failed;
    if (result.stoppedEarly) {
      total.stoppedEarly = true;
      break;
    }
  }
  const listings = total.checked + total.failed;
  const runFailed = total.stoppedEarly || (listings > 0 && total.failed / listings > MAX_FAILED_LISTING_SHARE);
  const failedCheckRuns = runFailed ? settings.failedCheckRuns + 1 : 0;
  const turnOff = failedCheckRuns >= MAX_FAILED_CHECK_RUNS;
  // Re-read so a switch flipped while the check ran isn't overwritten.
  const latest = await getDailySettings();
  await saveSettings({ ...latest, checkEnabled: turnOff ? false : latest.checkEnabled, failedCheckRuns, lastCheck: { day, ...total } }, null);
  await db.insert(auditLog).values({ action: turnOff ? "todaysPicksDailyCheckStopped" : "todaysPicksDailyCheck", entityType: "todays_picks_daily", entityId: null, actorId: null, payload: { day, ...total, failedCheckRuns } });
  return { ran: true, ...total };
}

export interface MarketingSummary {
  day: string;
  wentOnSale: { sku: string; itemName: string; listings: number }[];
  mismatches: { sku: string; listingId: string; ours: boolean; roblox: boolean | null }[];
  readyToFile: { sku: string; name: string }[];
  filedToday: { sku: string; name: string }[];
  blocked: { sku: string; itemName: string; firstProblem: string; problems: number }[];
  notStarted: number;
  check: DailySettings["lastCheck"];
}

/**
 * The day's marketing facts, from the Kanban's own records: listings ticked on sale that day,
 * our-tick-vs-Roblox mismatches from the latest checks, drafts with nothing left to fix, filings
 * Arjun confirmed that day, and what blocks the rest.
 *
 * Input: the India day (YYYY-MM-DD), and (for tests) the preview. Output: the summary.
 */
export async function buildMarketingSummary(day: string, loadItems: () => Promise<PreviewItem[]> = listTodaysPicksPreview): Promise<MarketingSummary> {
  const { start, end } = teamDayBounds(day);
  const items = await loadItems();
  const skus = items.map((i) => i.sku);
  const [onSaleRows, drafts, filedEvents, settings] = await Promise.all([
    db
      .select({ sku: assets.sku, itemName: assets.itemName, id: uploadRecords.id })
      .from(uploadRecords)
      .innerJoin(assets, eq(assets.id, uploadRecords.assetId))
      .where(and(gte(uploadRecords.onSaleAt, start), lt(uploadRecords.onSaleAt, end))),
    db
      .select({ sku: assets.sku, id: nominationDrafts.id, state: nominationDrafts.state, fields: nominationDrafts.fields, approvals: nominationDrafts.approvals, attemptNo: nominationDrafts.attemptNo })
      .from(nominationDrafts)
      .innerJoin(assets, eq(assets.id, nominationDrafts.assetId))
      .where(inArray(assets.sku, skus.concat(["-"]))),
    db
      .select({ sku: assets.sku, payload: nominationEvents.payload })
      .from(nominationEvents)
      .innerJoin(nominationDrafts, eq(nominationDrafts.id, nominationEvents.draftId))
      .innerJoin(assets, eq(assets.id, nominationDrafts.assetId))
      .where(and(eq(nominationEvents.kind, "owner_confirmed_filed"), gte(nominationEvents.createdAt, start), lt(nominationEvents.createdAt, end))),
    getDailySettings(),
  ]);

  const wentOnSale = new Map<string, { sku: string; itemName: string; listings: number }>();
  for (const r of onSaleRows) {
    const entry = wentOnSale.get(r.sku) ?? { sku: r.sku, itemName: r.itemName, listings: 0 };
    entry.listings++;
    wentOnSale.set(r.sku, entry);
  }

  const latestDraft = new Map<string, (typeof drafts)[number]>();
  for (const d of drafts) if (!latestDraft.has(d.sku) || latestDraft.get(d.sku)!.attemptNo < d.attemptNo) latestDraft.set(d.sku, d);

  const summary: MarketingSummary = { day, wentOnSale: [...wentOnSale.values()], mismatches: [], readyToFile: [], filedToday: [], blocked: [], notStarted: 0, check: settings.lastCheck };
  summary.filedToday = filedEvents.map((e) => ({ sku: e.sku, name: String((e.payload.fields as DraftFields | undefined)?.final_name ?? "") }));
  for (const item of items) {
    for (const l of item.listings) {
      if (l.lastCheck && !l.lastCheck.error && l.lastCheck.isForSale !== !!l.onSaleAt) summary.mismatches.push({ sku: item.sku, listingId: l.robloxAssetId ?? l.id, ours: !!l.onSaleAt, roblox: l.lastCheck.isForSale });
    }
    const draft = latestDraft.get(item.sku);
    if (draft?.state === "submitted") continue;
    if (!draft) {
      summary.notStarted++;
      continue;
    }
    const problems: DraftProblem[] = draftProblems(draft.fields as DraftFields, draft.approvals as NominationApprovals, item);
    if (problems.length === 0) summary.readyToFile.push({ sku: item.sku, name: (draft.approvals as NominationApprovals).final_name?.value ?? "" });
    else summary.blocked.push({ sku: item.sku, itemName: item.itemName, firstProblem: problems[0].message, problems: problems.length });
  }
  return summary;
}

/** Input: a summary. Output: the email's subject and HTML, in the app's standard email layout. */
export function renderMarketingEmail(summary: MarketingSummary): { subject: string; html: string } {
  const details: EmailDetailRow[] = [];
  for (const s of summary.wentOnSale) details.push({ label: `On sale: ${s.sku}`, value: `${s.itemName} (${s.listings} listing${s.listings === 1 ? "" : "s"} ticked today)` });
  for (const f of summary.filedToday) details.push({ label: `Filed: ${f.sku}`, value: `${f.name}. Arjun confirmed he filed it; not verified with Roblox.` });
  for (const r of summary.readyToFile) details.push({ label: `Ready to file: ${r.sku}`, value: r.name });
  for (const b of summary.blocked) details.push({ label: `Blocked: ${b.sku}`, value: `${b.firstProblem}${b.problems > 1 ? ` (+${b.problems - 1} more)` : ""}` });
  for (const m of summary.mismatches) details.push({ label: `Check: ${m.sku}`, value: `Listing ${m.listingId}: our tick says ${m.ours ? "on sale" : "off sale"}, Roblox says ${m.roblox ? "on sale" : "off sale"}` });
  const check = summary.check;
  const checkLine = !check
    ? "The daily Roblox check hasn't run yet."
    : check.day !== summary.day
      ? `The daily Roblox check last ran on ${check.day}.`
      : `Today's Roblox check: ${check.checked} listings checked, ${check.failed} failed${check.stoppedEarly ? ", stopped early by Roblox" : ""}.`;
  const dayLabel = new Date(`${summary.day}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const html = renderEmailLayout({
    preheader: `${summary.wentOnSale.length} went on sale, ${summary.filedToday.length} nominations filed, ${summary.blocked.length} blocked.`,
    eyebrow: "Marketing",
    tone: EMAIL_TONE.neutral,
    title: `Today's Picks, ${dayLabel}`,
    meta: [],
    imageUrl: null,
    stats: [
      { label: "Went on sale", value: String(summary.wentOnSale.length) },
      { label: "Filed today", value: String(summary.filedToday.length) },
    ],
    intro: `${summary.readyToFile.length} ready to file, ${summary.blocked.length} blocked, ${summary.notStarted} not started. ${checkLine}`,
    details: details.length ? details : [{ label: "Nothing new", value: "No sales ticks, filings or blockers today." }],
    note: "Filings are Arjun's own confirmations and cover the form's item page only. A nomination is a request to Roblox; Roblox picks items and only contacts selected creators.",
    button: { label: "Open Today's Picks", url: appUrl("/admin/marketing/todays-picks") },
    footer: "Sent each evening by the Meta Fashion pipeline to jsingh, ajohri and arjun.",
  });
  return { subject: `Marketing: Today's Picks, ${dayLabel}`, html };
}

/**
 * Sends today's marketing email to MARKETING_EMAIL_RECIPIENTS once, if the email is switched on.
 *
 * Input: now. Output: whether it was sent, or why not.
 */
export async function sendMarketingSummary(now: Date): Promise<{ sent: boolean; reason?: string; recipients?: number }> {
  const settings = await getDailySettings();
  if (!settings.emailEnabled) return { sent: false, reason: "marketing email is off" };
  const day = teamDay(now);
  if (!(await claimDay(LAST_EMAIL_KEY, day))) return { sent: false, reason: "already sent today" };
  const { subject, html } = renderMarketingEmail(await buildMarketingSummary(day));
  for (const to of MARKETING_EMAIL_RECIPIENTS) await enqueueEmail({ toEmail: to, subject, bodyHtml: html });
  await sendDueEmails();
  await db.insert(auditLog).values({ action: "sendTodaysPicksSummary", entityType: "todays_picks_daily", entityId: null, actorId: null, payload: { day, recipients: MARKETING_EMAIL_RECIPIENTS } });
  return { sent: true, recipients: MARKETING_EMAIL_RECIPIENTS.length };
}
