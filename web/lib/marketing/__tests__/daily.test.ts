import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { robloxListingChecks } from "@/lib/db/schema/roblox_listing_checks";
import { buildMarketingSummary, getDailySettings, MARKETING_EMAIL_RECIPIENTS, renderMarketingEmail, runDailyCheck, sendMarketingSummary, setDailySwitches } from "../todays-picks-daily";

const SKU_PREFIX = "TEST-DAILY-";
const SETTING_KEYS = ["todays_picks_daily", "todays_picks_daily_last_check", "todays_picks_daily_last_email"];
const SUBJECT_PATTERN = "Marketing: Today's Picks%";

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${SKU_PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(uploadRecords).where(inArray(uploadRecords.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
  await db.delete(emailQueue).where(like(emailQueue.subject, SUBJECT_PATTERN));
  await db.delete(auditLog).where(eq(auditLog.entityType, "todays_picks_daily"));
}

const day = (d: string) => new Date(`${d}T14:00:00Z`);
const ok = async () => ({ checked: 2, failed: 0, stoppedEarly: false });
const limited = async () => ({ checked: 0, failed: 1, stoppedEarly: true });
const queued = async () => db.select().from(emailQueue).where(like(emailQueue.subject, SUBJECT_PATTERN));

async function seed() {
  const [asset] = await db.insert(assets).values({ sku: `${SKU_PREFIX}HAT`, itemName: "Daily hat", currentStatus: "uploaded_to_roblox" }).returning();
  const [onSale, offSale] = await db
    .insert(uploadRecords)
    .values([
      { assetId: asset.id, robloxAssetId: "8801", robloxItemUrl: "https://www.roblox.com/catalog/8801", onSaleAt: day("2026-10-14") },
      { assetId: asset.id, robloxAssetId: "8802", robloxItemUrl: "https://www.roblox.com/catalog/8802" },
    ])
    .returning();
  // Roblox says the unticked one is on sale: a mismatch the email must report.
  await db.insert(robloxListingChecks).values([
    { uploadRecordId: onSale.id, isForSale: true, robloxName: "Daily Hat", ourOnSale: true, httpStatus: 200 },
    { uploadRecordId: offSale.id, isForSale: true, robloxName: "Daily Hat Blue", ourOnSale: false, httpStatus: 200 },
  ]);
}

async function test() {
  await cleanup();
  await seed();

  console.log("Verifying both jobs stay off until switched on...");
  assert.deepStrictEqual(await getDailySettings(), { checkEnabled: false, emailEnabled: false, failedCheckRuns: 0, lastCheck: null });
  assert.strictEqual((await runDailyCheck(day("2026-10-14"), ok)).ran, false);
  assert.strictEqual((await sendMarketingSummary(day("2026-10-14"))).sent, false);
  assert.strictEqual((await queued()).length, 0, "No email while off");

  console.log("Verifying the check runs once a day and turns itself off after 3 failed runs...");
  await setDailySwitches({ checkEnabled: true }, null);
  const first = await runDailyCheck(day("2026-10-14"), ok);
  assert.ok(first.ran && first.checked !== undefined && first.checked > 0);
  assert.strictEqual((await runDailyCheck(day("2026-10-14"), ok)).reason, "already ran today");
  for (const d of ["2026-10-15", "2026-10-16"]) await runDailyCheck(day(d), limited);
  assert.strictEqual((await getDailySettings()).checkEnabled, true, "Two failed runs keep it on");
  await runDailyCheck(day("2026-10-17"), limited);
  const stopped = await getDailySettings();
  assert.ok(!stopped.checkEnabled && stopped.failedCheckRuns === 3, "The third failed run turns it off");
  await setDailySwitches({ checkEnabled: true }, null);
  assert.strictEqual((await getDailySettings()).failedCheckRuns, 0, "Turning it back on clears the count");

  console.log("Verifying the summary and the email's wording...");
  const summary = await buildMarketingSummary("2026-10-14");
  assert.ok(summary.wentOnSale.some((s) => s.sku === `${SKU_PREFIX}HAT` && s.listings === 1), "The listing ticked that day is reported");
  assert.ok(summary.mismatches.some((m) => m.listingId === "8802" && !m.ours && m.roblox === true), "Our tick vs Roblox mismatch is reported");
  const { subject, html } = renderMarketingEmail(summary);
  assert.ok(subject.startsWith("Marketing: Today's Picks"));
  assert.ok(html.includes("not verified with Roblox") || html.includes("Arjun&#39;s own confirmations"), "Filings are described as owner-confirmed");
  assert.ok(html.includes("request to Roblox"), "A nomination isn't described as a feature");

  console.log("Verifying the email goes to exactly three people, once a day...");
  await setDailySwitches({ emailEnabled: true }, null);
  const sent = await sendMarketingSummary(day("2026-10-14"));
  assert.ok(sent.sent && sent.recipients === 3);
  assert.deepStrictEqual((await queued()).map((e) => e.toEmail).sort(), [...MARKETING_EMAIL_RECIPIENTS].sort());
  assert.strictEqual((await sendMarketingSummary(day("2026-10-14"))).reason, "already sent today");
  assert.strictEqual((await queued()).length, 3, "No second email the same day");
  console.log("Confirmed daily automation");
}

test()
  .then(async () => {
    await cleanup();
    console.log("✓ All daily automation assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
