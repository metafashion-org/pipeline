import assert from "node:assert";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamTaskHelpers } from "@/lib/db/schema/team_task_helpers";
import { teamTaskRecurrences } from "@/lib/db/schema/team_task_recurrences";
import { auditLog } from "@/lib/db/schema/audit_log";
import { createRecurrence, makeRecurringTasksFor } from "../recurring-service";
import { TeamTaskInputError } from "../team-tasks-service";
import { repeatsOn } from "../task-rules";

const OWNER_EMAIL = "test-monthly-owner@example.com";
const HELPER_EMAIL = "test-monthly-helper@example.com";
const EMAILS = [OWNER_EMAIL, HELPER_EMAIL];

async function cleanup() {
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, EMAILS));
  const ids = people.map((p) => p.id);
  if (ids.length === 0) return;
  const tasks = await db.select({ id: teamTasks.id }).from(teamTasks).where(inArray(teamTasks.ownerId, ids));
  if (tasks.length > 0) await db.delete(auditLog).where(inArray(auditLog.entityId, tasks.map((t) => t.id)));
  await db.delete(teamTasks).where(inArray(teamTasks.ownerId, ids));
  const rules = await db.select({ id: teamTaskRecurrences.id }).from(teamTaskRecurrences).where(inArray(teamTaskRecurrences.ownerId, ids));
  if (rules.length > 0) await db.delete(auditLog).where(inArray(auditLog.entityId, rules.map((r) => r.id)));
  await db.delete(teamTaskRecurrences).where(inArray(teamTaskRecurrences.ownerId, ids));
  await db.delete(auditLog).where(inArray(auditLog.actorId, ids));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

function testRepeatsOn() {
  console.log("Verifying dates of the month, including a date the month doesn't have...");
  assert.strictEqual(repeatsOn("2032-03-15", [], [15, 30]), true);
  assert.strictEqual(repeatsOn("2032-03-16", [], [15, 30]), false);
  assert.strictEqual(repeatsOn("2032-02-29", [], [15, 30]), true, "The 30th falls on the last day of February");
  assert.strictEqual(repeatsOn("2031-02-28", [], [30]), true, "Also in a non-leap year");
  assert.strictEqual(repeatsOn("2032-03-30", [], [15, 30]), true);
  assert.strictEqual(repeatsOn("2032-03-31", [], [15, 30]), false, "The 30th of a 31-day month is the 30th, not the 31st");
  assert.strictEqual(repeatsOn("2032-03-15", [1], []), true, "15 Mar 2032 is a Monday, so a Monday rule falls on it");
  console.log("Confirmed the date rules");
}

async function testPaymentsReminder() {
  console.log("Verifying a 15th-and-30th reminder is made with its helper and stays open until done...");
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Monthly Owner", email: OWNER_EMAIL, roles: ["operator", "full_time"] }).returning();
  const [helper] = await db.insert(personnel).values({ name: "Monthly Helper", email: HELPER_EMAIL, roles: ["admin", "full_time"] }).returning();
  await assert.rejects(
    () => createRecurrence({ title: "Bad", area: "finance", ownerId: owner.id, weekdays: [], monthDays: [32], startsOn: "2032-03-01" }, owner.id),
    TeamTaskInputError
  );
  await createRecurrence(
    { title: "Process freelancer payments", area: "finance", ownerId: owner.id, weekdays: [], monthDays: [15, 30], helperIds: [helper.id], startsOn: "2032-03-01" },
    helper.id
  );

  await makeRecurringTasksFor("2032-03-14");
  await makeRecurringTasksFor("2032-03-15");
  await makeRecurringTasksFor("2032-03-30");
  const tasks = await db.select().from(teamTasks).where(eq(teamTasks.ownerId, owner.id));
  assert.deepStrictEqual(tasks.map((t) => t.occurrenceOn).sort(), ["2032-03-15", "2032-03-30"], "One task on each date, none on the 14th");
  assert.ok(tasks.every((t) => t.status === "todo"), "A reminder without a count isn't closed when the next one is made");

  const helpers = await db
    .select()
    .from(teamTaskHelpers)
    .where(and(inArray(teamTaskHelpers.taskId, tasks.map((t) => t.id)), eq(teamTaskHelpers.personnelId, helper.id)));
  assert.strictEqual(helpers.length, 2, "Each task gets the rule's helper");
  console.log("Confirmed the payments reminder");
}

async function run() {
  testRepeatsOn();
  await testPaymentsReminder();
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All monthly repeat assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
