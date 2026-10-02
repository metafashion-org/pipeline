import { and, asc, eq, gte, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teamTaskRecurrences } from "@/lib/db/schema/team_task_recurrences";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamTaskHelpers } from "@/lib/db/schema/team_task_helpers";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { listTeamMembers } from "./team-members";
import { addToDayPlan, TEAM_TASK_ENTITY, TeamTaskInputError, TeamTaskNotFoundError } from "./team-tasks-service";
import { DONE_STATUS, isTeamTaskArea, repeatsOn } from "./task-rules";

// Where recurrence changes are logged in audit_log.
const RECURRENCE_ENTITY = "team_task_recurrence";
const SUNDAY = 0;
const SATURDAY = 6;
const FIRST_MONTH_DAY = 1;
const LAST_MONTH_DAY = 31;

export interface RecurrenceInput {
  title: string;
  area: string;
  ownerId: string;
  /** 0 = Sunday ... 6 = Saturday. */
  weekdays: number[];
  /** Dates of the month, 1-31. A date a month doesn't have falls on its last day (30 -> 28 Feb). */
  monthDays?: number[];
  /** People helping the owner on each task it makes. */
  helperIds?: string[];
  targetCount?: number | null;
  focus?: string | null;
  focusUntil?: string | null;
  startsOn: string;
  endsOn?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

async function validateRecurrence(input: RecurrenceInput): Promise<void> {
  if (!input.title.trim()) throw new TeamTaskInputError("The repeating task needs a title");
  if (!isTeamTaskArea(input.area)) throw new TeamTaskInputError("Pick what kind of task it is");
  const monthDays = input.monthDays ?? [];
  if (input.weekdays.some((d) => !Number.isInteger(d) || d < SUNDAY || d > SATURDAY)) throw new TeamTaskInputError("Those aren't weekdays");
  if (monthDays.some((d) => !Number.isInteger(d) || d < FIRST_MONTH_DAY || d > LAST_MONTH_DAY)) {
    throw new TeamTaskInputError("Dates of the month go from 1 to 31");
  }
  if (input.weekdays.length === 0 && monthDays.length === 0) throw new TeamTaskInputError("Pick the days it repeats on");
  const members = new Set((await listTeamMembers()).map((m) => m.id));
  if (!members.has(input.ownerId)) throw new TeamTaskInputError("The owner must be someone on the full-time team");
  if ((input.helperIds ?? []).some((id) => !members.has(id))) throw new TeamTaskInputError("Each helper must be someone on the full-time team");
}

function recurrenceValues(input: RecurrenceInput) {
  return {
    title: input.title.trim(),
    area: input.area,
    ownerId: input.ownerId,
    weekdays: [...new Set(input.weekdays)].sort((a, b) => a - b),
    monthDays: [...new Set(input.monthDays ?? [])].sort((a, b) => a - b),
    helperIds: [...new Set(input.helperIds ?? [])].filter((id) => id !== input.ownerId),
    targetCount: input.targetCount ?? null,
    focus: input.focus?.trim() || null,
    focusUntil: input.focusUntil || null,
    startsOn: input.startsOn,
    endsOn: input.endsOn || null,
    notes: input.notes?.trim() || null,
    isActive: input.isActive ?? true,
  };
}

/** Every repeating task with its owner's name, active ones first. */
export async function listRecurrences() {
  return db
    .select({ recurrence: teamTaskRecurrences, ownerName: personnel.name })
    .from(teamTaskRecurrences)
    .innerJoin(personnel, eq(personnel.id, teamTaskRecurrences.ownerId))
    .orderBy(sql`${teamTaskRecurrences.isActive} desc`, asc(teamTaskRecurrences.title));
}

/**
 * Makes a repeating task, e.g. "Curate assets", 45 a day, Monday to Saturday, focus "Christmas"
 * until 31 December.
 *
 * Input: the rule and who made it. Output: its id. Throws TeamTaskInputError.
 */
export async function createRecurrence(input: RecurrenceInput, actorId: string | null): Promise<string> {
  await validateRecurrence(input);
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(teamTaskRecurrences)
      .values({ ...recurrenceValues(input), createdBy: actorId })
      .returning({ id: teamTaskRecurrences.id });
    await tx.insert(auditLog).values({ action: "createRecurrence", entityType: RECURRENCE_ENTITY, entityId: created.id, actorId, payload: { ...input } });
    return created.id;
  });
}

/**
 * Changes a repeating task. Tasks it already made keep what they were made with; the next day's
 * task follows the new rule.
 *
 * Input: the rule's id, the whole rule as it should now be, and who changed it. Output: nothing.
 */
export async function updateRecurrence(id: string, input: RecurrenceInput, actorId: string | null): Promise<void> {
  await validateRecurrence(input);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(teamTaskRecurrences)
      .set({ ...recurrenceValues(input), updatedAt: new Date() })
      .where(eq(teamTaskRecurrences.id, id))
      .returning({ id: teamTaskRecurrences.id });
    if (!updated) throw new TeamTaskNotFoundError("That repeating task doesn't exist");
    await tx.insert(auditLog).values({ action: "updateRecurrence", entityType: RECURRENCE_ENTITY, entityId: id, actorId, payload: { ...input } });
  });
}

/**
 * Makes the day's task for every repeating task that falls on that day, with its helpers, and puts
 * it in the owner's plan for the day. For counted work (a rule with a target) the earlier open
 * tasks from the same rule are closed as done: each day's task stands for that day, so yesterday's
 * count stays as it was left. Other repeating tasks, such as a payments reminder, stay open until
 * someone finishes them.
 *
 * Safe to run any number of times a day: a rule makes at most one task per day.
 *
 * Input: the day. Output: how many tasks were made.
 */
export async function makeRecurringTasksFor(day: string): Promise<number> {
  const active = await db
    .select()
    .from(teamTaskRecurrences)
    .where(
      and(
        eq(teamTaskRecurrences.isActive, true),
        lte(teamTaskRecurrences.startsOn, day),
        or(isNull(teamTaskRecurrences.endsOn), gte(teamTaskRecurrences.endsOn, day))
      )
    );
  const rules = active.filter((rule) => repeatsOn(day, rule.weekdays, rule.monthDays));

  let made = 0;
  for (const rule of rules) {
    const created = await db.transaction(async (tx) => {
      const focus = rule.focus && (!rule.focusUntil || rule.focusUntil >= day) ? rule.focus : null;
      const [task] = await tx
        .insert(teamTasks)
        .values({
          title: rule.title,
          notes: rule.notes,
          area: rule.area,
          ownerId: rule.ownerId,
          dueOn: day,
          targetCount: rule.targetCount,
          focus,
          recurrenceId: rule.id,
          occurrenceOn: day,
          // Repeating tasks sit at the top of the owner's list.
          position: -1,
          createdBy: rule.createdBy,
        })
        .onConflictDoNothing()
        .returning({ id: teamTasks.id });
      if (!task) return false;

      if (rule.targetCount !== null) {
        const now = new Date();
        await tx
          .update(teamTasks)
          .set({ status: DONE_STATUS, completedAt: now, updatedAt: now })
          .where(and(eq(teamTasks.recurrenceId, rule.id), lt(teamTasks.occurrenceOn, day), ne(teamTasks.status, DONE_STATUS)));
      }
      const helperIds = rule.helperIds.filter((id) => id !== rule.ownerId);
      if (helperIds.length > 0) {
        await tx.insert(teamTaskHelpers).values(helperIds.map((personnelId) => ({ taskId: task.id, personnelId }))).onConflictDoNothing();
      }
      await addToDayPlan(tx, rule.ownerId, task.id, day);
      await tx.insert(auditLog).values({
        action: "makeRecurringTask",
        entityType: TEAM_TASK_ENTITY,
        entityId: task.id,
        actorId: null,
        payload: { recurrenceId: rule.id, day, focus },
      });
      return true;
    });
    if (created) made += 1;
  }
  return made;
}
