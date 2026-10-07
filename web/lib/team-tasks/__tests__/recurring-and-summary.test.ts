import assert from "node:assert";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamTaskRecurrences } from "@/lib/db/schema/team_task_recurrences";
import { auditLog } from "@/lib/db/schema/audit_log";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { appSettings } from "@/lib/db/schema/app_settings";
import { createRecurrence, makeRecurringTasksFor, updateRecurrence } from "../recurring-service";
import { createTeamTask, updateTeamTask } from "../team-tasks-service";
import { getTeamBoard, getTeamWeek } from "../team-board";
import { buildDailySummary, sendDailySummary } from "../daily-summary";
import { addDays, taskSignals, teamDay, teamDayBounds, weekStartOf, weekdayOf } from "../task-rules";

const CURATOR_EMAIL = "test-team-recurring-curator@example.com";
const SUMMARY_KEY = "team_summary_last_sent_on";
// A Monday far from today, so nothing else in the database falls on these days.
const MONDAY = "2031-12-01";

async function cleanup() {
  const people = await db.select({ id: personnel.id }).from(personnel).where(eq(personnel.email, CURATOR_EMAIL));
  const ids = people.map((p) => p.id);
  if (ids.length > 0) {
    const tasks = await db.select({ id: teamTasks.id }).from(teamTasks).where(inArray(teamTasks.ownerId, ids));
    if (tasks.length > 0) await db.delete(auditLog).where(inArray(auditLog.entityId, tasks.map((t) => t.id)));
    await db.delete(teamTasks).where(inArray(teamTasks.ownerId, ids));
    const rules = await db.select({ id: teamTaskRecurrences.id }).from(teamTaskRecurrences).where(inArray(teamTaskRecurrences.ownerId, ids));
    if (rules.length > 0) await db.delete(auditLog).where(inArray(auditLog.entityId, rules.map((r) => r.id)));
    await db.delete(teamTaskRecurrences).where(inArray(teamTaskRecurrences.ownerId, ids));
    await db.delete(auditLog).where(inArray(auditLog.actorId, ids));
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
  }
  await db.delete(auditLog).where(eq(auditLog.entityId, MONDAY));
  await db.delete(emailQueue).where(eq(emailQueue.toEmail, CURATOR_EMAIL));
  await db.delete(appSettings).where(eq(appSettings.key, SUMMARY_KEY));
  await db.delete(personnel).where(eq(personnel.email, CURATOR_EMAIL));
}

function testDateRules() {
  console.log("Verifying the India-time day rules...");
  // 20:00 UTC on 30 Sep is 01:30 on 1 Oct in India.
  assert.strictEqual(teamDay(new Date("2026-09-30T20:00:00Z")), "2026-10-01");
  assert.strictEqual(teamDayBounds("2026-10-01").start.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.strictEqual(weekdayOf(MONDAY), 1);
  assert.strictEqual(addDays("2026-12-31", 1), "2027-01-01");
  assert.strictEqual(weekStartOf("2031-12-07"), MONDAY, "Sunday belongs to the week that started on Monday");
  const now = new Date("2026-10-05T12:00:00Z");
  assert.deepStrictEqual(taskSignals({ status: "todo", dueOn: "2026-10-04", lastActivityAt: "2026-10-05T10:00:00Z" }, "2026-10-05", now), {
    overdue: true,
    dueToday: false,
    stale: false,
  });
  assert.strictEqual(taskSignals({ status: "doing", dueOn: null, lastActivityAt: "2026-10-03T11:00:00Z" }, "2026-10-05", now).stale, true, "Two days untouched is stale");
  assert.strictEqual(taskSignals({ status: "done", dueOn: "2026-10-01", lastActivityAt: "2026-09-01T00:00:00Z" }, "2026-10-05", now).overdue, false, "A done task carries no flags");
  console.log("Confirmed the day rules");
}

// The curator's tasks for a day. Counted this way rather than from makeRecurringTasksFor's return,
// which also counts any other rule in the database that falls on the day.
async function tasksOn(curatorId: string, day: string) {
  return db.select().from(teamTasks).where(and(eq(teamTasks.ownerId, curatorId), eq(teamTasks.occurrenceOn, day)));
}

async function testRecurringCountedWork(curatorId: string) {
  console.log("Verifying a daily counted task with a seasonal focus is made once a day and yesterday's is closed...");
  const tuesday = addDays(MONDAY, 1);
  const input = {
    title: "Curate assets",
    area: "curation",
    ownerId: curatorId,
    weekdays: [1, 2, 3, 4, 5, 6],
    targetCount: 45,
    focus: "Christmas",
    focusUntil: MONDAY,
    startsOn: MONDAY,
  };
  const ruleId = await createRecurrence(input, curatorId);
  await makeRecurringTasksFor(MONDAY);
  assert.strictEqual((await tasksOn(curatorId, MONDAY)).length, 1, "Monday's task is made");
  await makeRecurringTasksFor(MONDAY);
  assert.strictEqual((await tasksOn(curatorId, MONDAY)).length, 1, "Running again the same day makes nothing more");
  await makeRecurringTasksFor(addDays(MONDAY, -1));
  assert.strictEqual((await tasksOn(curatorId, addDays(MONDAY, -1))).length, 0, "Nothing is made before the rule starts");

  const [monday] = await tasksOn(curatorId, MONDAY);
  assert.strictEqual(monday.focus, "Christmas");
  assert.strictEqual(monday.targetCount, 45);
  const board = await getTeamBoard(MONDAY, null);
  assert.ok(board.plans.some((p) => p.personnelId === curatorId && p.taskId === monday.id), "The day's task is in the owner's plan");

  await updateTeamTask(monday.id, { doneCount: 38 }, MONDAY, curatorId);
  await makeRecurringTasksFor(tuesday);
  assert.strictEqual((await tasksOn(curatorId, tuesday)).length, 1, "Tuesday's task is made");
  const [mondayAfter] = await db.select().from(teamTasks).where(eq(teamTasks.id, monday.id));
  assert.strictEqual(mondayAfter.status, "done", "Monday's task is closed when Tuesday's is made");
  assert.strictEqual(mondayAfter.doneCount, 38, "Monday's count stays as it was left");
  const [tuesdayTask] = await tasksOn(curatorId, tuesday);
  assert.strictEqual(tuesdayTask.focus, null, "The focus ends after its last day");

  await updateRecurrence(ruleId, { ...input, isActive: false }, curatorId);
  await makeRecurringTasksFor(addDays(MONDAY, 2));
  assert.strictEqual((await tasksOn(curatorId, addDays(MONDAY, 2))).length, 0, "A switched-off rule makes nothing");

  const week = await getTeamWeek(MONDAY, null);
  const curatorWeek = week.people.find((p) => p.member.id === curatorId);
  assert.deepStrictEqual(
    curatorWeek?.days[0].counted.map((c) => [c.doneCount, c.targetCount, c.focus]),
    [[38, 45, "Christmas"]],
    "The week view shows Monday's count"
  );
  console.log("Confirmed repeating counted work");
  return tuesdayTask.id;
}

async function testDailySummary(curatorId: string, countedTaskId: string) {
  console.log("Verifying the 7 pm summary covers done, doing, blocked and counted work, and goes out once a day...");
  const tuesday = addDays(MONDAY, 1);
  const doneId = await createTeamTask({ title: "Shortlist Christmas hats", area: "curation", ownerId: curatorId }, tuesday, curatorId);
  const blockedId = await createTeamTask({ title: "Pinterest board access", area: "curation", ownerId: curatorId }, tuesday, curatorId);
  await updateTeamTask(countedTaskId, { doneCount: 20, status: "doing" }, tuesday, curatorId);
  await updateTeamTask(blockedId, { status: "blocked", waitingOn: "Arjun" }, tuesday, curatorId);
  // Marked done "on Tuesday": completedAt must fall inside Tuesday in India for the summary to count it.
  await updateTeamTask(doneId, { status: "done" }, tuesday, curatorId);
  await db.update(teamTasks).set({ completedAt: new Date(`${tuesday}T12:00:00+05:30`) }).where(eq(teamTasks.id, doneId));

  const summaries = await buildDailySummary(tuesday, new Date(`${tuesday}T19:00:00+05:30`));
  const curator = summaries.find((s) => s.member.id === curatorId);
  assert.deepStrictEqual(curator?.done, ["Shortlist Christmas hats"]);
  assert.deepStrictEqual(curator?.doing, ["Curate assets"]);
  assert.deepStrictEqual(curator?.blocked, [{ title: "Pinterest board access", waitingOn: "Arjun" }]);
  assert.deepStrictEqual(curator?.counted, [{ title: "Curate assets", focus: null, doneCount: 20, targetCount: 45 }]);

  const first = await sendDailySummary(tuesday, new Date(`${tuesday}T19:00:00+05:30`));
  const second = await sendDailySummary(tuesday, new Date(`${tuesday}T19:05:00+05:30`));
  assert.strictEqual(first.sent, true);
  assert.strictEqual(second.sent, false, "A second run the same day sends nothing");
  const emails = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, CURATOR_EMAIL));
  assert.strictEqual(emails.filter((e) => e.subject.startsWith("Team Tasks:")).length, 1, "One summary email per person");
  assert.ok(emails.some((e) => e.bodyHtml.includes("20 of 45")), "The email shows the count");
  console.log("Confirmed the daily summary");
}

async function run() {
  testDateRules();
  await cleanup();
  const [curator] = await db.insert(personnel).values({ name: "Recurring Curator", email: CURATOR_EMAIL, roles: ["curator", "full_time"] }).returning();
  const countedTaskId = await testRecurringCountedWork(curator.id);
  await testDailySummary(curator.id, countedTaskId);
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All recurring and summary assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
