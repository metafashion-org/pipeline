import assert from "node:assert";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { eodReports } from "@/lib/db/schema/eod_reports";
import { personnel } from "@/lib/db/schema/personnel";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { DEFAULT_TEAM_RHYTHM, nextWorkDay, planDays } from "../team-rhythm";
import { EodInputError, getEodReference, isFirstWorkDayOfWeek, isLateEod, lastWeekEodLines, saveEod, sendEodReminderIfDue } from "../eod-service";
import { buildDailySummary, sendDailySummary } from "../daily-summary";
import { createTeamTask, setTeamDayPlan } from "../team-tasks-service";

const WRITER_EMAIL = "test-eod-writer@example.com";
const SILENT_EMAIL = "test-eod-silent@example.com";
const EMAILS = [WRITER_EMAIL, SILENT_EMAIL];
// A Tuesday, with Wednesday after it; neither is used by the other summary tests.
const DAY = "2026-11-17";
const NEXT_DAY = "2026-11-18";
const at = (time: string, day = DAY) => new Date(`${day}T${time}:00+05:30`);

async function cleanup() {
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, EMAILS));
  const ids = people.map((p) => p.id);
  if (ids.length > 0) {
    const tasks = await db.select({ id: teamTasks.id }).from(teamTasks).where(inArray(teamTasks.ownerId, ids));
    if (tasks.length > 0) await db.delete(auditLog).where(inArray(auditLog.entityId, tasks.map((t) => t.id)));
    await db.delete(teamTasks).where(inArray(teamTasks.ownerId, ids));
    await db.delete(auditLog).where(inArray(auditLog.actorId, ids));
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(eodReports).where(inArray(eodReports.personnelId, ids));
  }
  await db.delete(emailQueue).where(inArray(emailQueue.toEmail, EMAILS));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
  await db.delete(appSettings).where(inArray(appSettings.key, ["eod_reminder_last_sent_on", "team_rhythm"]));
}

function testDayRules() {
  console.log("Verifying which days can be planned...");
  const saturday = "2026-10-10";
  assert.strictEqual(nextWorkDay(saturday, DEFAULT_TEAM_RHYTHM), "2026-10-12", "Saturday plans Monday when Sunday is off");
  const days = planDays(saturday, DEFAULT_TEAM_RHYTHM);
  assert.strictEqual(days[0], saturday, "Today comes first");
  assert.ok(!days.includes("2026-10-11"), "Sunday can't be planned");
  assert.strictEqual(days.length, DEFAULT_TEAM_RHYTHM.planAheadDays + 1, "Today plus the plan-ahead work days");
  assert.ok(isFirstWorkDayOfWeek("2026-10-12", DEFAULT_TEAM_RHYTHM) && !isFirstWorkDayOfWeek(DAY, DEFAULT_TEAM_RHYTHM), "Monday starts the week");

  assert.ok(!isLateEod({ reportOn: DAY, submittedAt: at("18:30") }, DEFAULT_TEAM_RHYTHM), "On the due minute is on time");
  assert.ok(isLateEod({ reportOn: DAY, submittedAt: at("18:31") }, DEFAULT_TEAM_RHYTHM), "After it is late");
  assert.ok(isLateEod({ reportOn: DAY, submittedAt: at("09:00", NEXT_DAY) }, DEFAULT_TEAM_RHYTHM), "Next morning is late");
}

async function run() {
  testDayRules();
  await cleanup();
  const [writer] = await db.insert(personnel).values({ name: "EOD Writer", email: WRITER_EMAIL, roles: ["full_time", "curator"] }).returning();
  const [silent] = await db.insert(personnel).values({ name: "EOD Silent", email: SILENT_EMAIL, roles: ["Full_Time"] }).returning();

  console.log("Verifying an EOD is the person's own words, sent once and editable...");
  await assert.rejects(saveEod(writer.id, DAY, { done: " ", slipped: "", blockers: "", needFromManager: "", nextOutcome: "" }, at("18:00")), EodInputError);
  const first = await saveEod(writer.id, DAY, { done: "Shortlisted 40 hats", slipped: "Pinterest pass", blockers: "", needFromManager: "Sign-off on the hat list", nextOutcome: "Hat drop ready Friday" }, at("18:20"));
  const edited = await saveEod(writer.id, DAY, { done: "Shortlisted 45 hats", slipped: "Pinterest pass", blockers: "", needFromManager: "Sign-off on the hat list", nextOutcome: "Hat drop ready Friday" }, at("18:50"));
  assert.strictEqual(edited.id, first.id, "One EOD per person per day");
  assert.strictEqual(edited.submittedAt.getTime(), at("18:20").getTime(), "Editing keeps the time it was sent");
  assert.strictEqual(edited.done, "Shortlisted 45 hats");

  console.log("Verifying the EOD form's reference shows today's plan and the next work day's...");
  const todayTask = await createTeamTask({ title: "Shortlist hats", area: "curation", ownerId: writer.id }, DAY, writer.id);
  const nextTask = await createTeamTask({ title: "Pinterest pass", area: "curation", ownerId: writer.id }, DAY, writer.id);
  await setTeamDayPlan(writer.id, DAY, [todayTask], writer.id);
  await setTeamDayPlan(writer.id, NEXT_DAY, [nextTask], writer.id);
  const reference = await getEodReference(writer.id, DAY, DEFAULT_TEAM_RHYTHM);
  assert.strictEqual(reference.nextDay, NEXT_DAY);
  assert.deepStrictEqual(reference.todayPlan.map((p) => p.title), ["Shortlist hats"]);
  assert.deepStrictEqual(reference.nextPlan.map((p) => p.title), ["Pinterest pass"], "Planning ahead is kept for the next day");

  console.log("Verifying the reminder pings only people without an EOD, once, after its time...");
  assert.strictEqual((await sendEodReminderIfDue(at("18:00"))).sent, false, "Nothing before the reminder time");
  const reminder = await sendEodReminderIfDue(at("18:16"));
  assert.ok(reminder.sent && reminder.reminded.includes("EOD Silent") && !reminder.reminded.includes("EOD Writer"));
  assert.strictEqual((await sendEodReminderIfDue(at("18:31"))).sent, false, "Once a day");

  console.log("Verifying the summary carries each EOD and names who didn't send one...");
  const summaries = await buildDailySummary(DAY, at("19:00"));
  const writerSummary = summaries.find((s) => s.member.id === writer.id);
  assert.strictEqual(writerSummary?.eod?.done, "Shortlisted 45 hats");
  assert.strictEqual(writerSummary?.eodLate, false, "Sent at 18:20 is on time even though it was edited later");
  assert.strictEqual(summaries.find((s) => s.member.id === silent.id)?.eod, null);
  await sendDailySummary(DAY, at("19:00"));
  const [email] = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, SILENT_EMAIL));
  assert.ok(email?.bodyHtml.includes("No EOD from:") && email.bodyHtml.includes("EOD Silent"), "The email names who didn't send one");
  assert.ok(email.bodyHtml.includes("Sign-off on the hat list"), "The email carries the EOD in the person's words");

  console.log("Verifying last week's record for the first summary of a week...");
  const nextMonday = "2026-11-23";
  const lines = await lastWeekEodLines(nextMonday, [writer, silent].map((p) => ({ id: p.id, name: p.name, email: p.email, discordUserId: null })), DEFAULT_TEAM_RHYTHM);
  assert.strictEqual(lines.get(writer.id), "1 of 6 sent, 1 on time");
  assert.strictEqual(lines.get(silent.id), "0 of 6 sent, 0 on time");
  console.log("Confirmed EODs");
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All EOD assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
