// End-of-day reports. Each person on the full-time team writes their own in Team Tasks, in their
// own words: nothing is filled in for them. Their plan for the next work day is their plan on the
// board. The evening summary emails everyone's EOD to the team, names who didn't send one, and
// marks the late ones; an optional reminder pings people who haven't written theirs yet.

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eodReports } from "@/lib/db/schema/eod_reports";
import { teamTaskDayPlans } from "@/lib/db/schema/team_task_day_plans";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { postToOfficeChannel } from "@/lib/discord/office-channel";
import { appUrl } from "@/lib/app-url";
import { listTeamMembers, type TeamMember } from "./team-members";
import { addDays, DONE_STATUS, TEAM_TIMEZONE, teamDay, weekStartOf } from "./task-rules";
import { getTeamRhythm, isWorkDay, minutesOf, nextWorkDay, type TeamRhythm } from "./team-rhythm";

// The day the EOD reminder last went out, so the cron firing every 15 minutes pings once a day.
const REMINDER_SENT_SETTING_KEY = "eod_reminder_last_sent_on";
const MINUTES_PER_HOUR = 60;

export class EodInputError extends Error {}

export interface EodFields {
  done: string;
  slipped: string;
  blockers: string;
  needFromManager: string;
  nextOutcome: string;
}

export interface EodReport extends EodFields {
  id: string;
  personnelId: string;
  reportOn: string;
  submittedAt: Date;
  updatedAt: Date;
}

/** Minutes past midnight, India time, at a moment. */
export function teamMinutesNow(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TEAM_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * MINUTES_PER_HOUR + minute;
}

/** Whether an EOD was sent after the due time on its own day, or on a later day. */
export function isLateEod(report: Pick<EodReport, "reportOn" | "submittedAt">, rhythm: TeamRhythm): boolean {
  const sentOn = teamDay(report.submittedAt);
  if (sentOn !== report.reportOn) return sentOn > report.reportOn;
  return teamMinutesNow(report.submittedAt) > minutesOf(rhythm.eodDueTime);
}

/** One person's EOD for a day, or null when they haven't written it. */
export async function getEod(personnelId: string, day: string): Promise<EodReport | null> {
  const [row] = await db
    .select()
    .from(eodReports)
    .where(and(eq(eodReports.personnelId, personnelId), eq(eodReports.reportOn, day)))
    .limit(1);
  return row ?? null;
}

/** Everyone's EOD for a day, by person. */
export async function listEods(day: string): Promise<Map<string, EodReport>> {
  const rows = await db.select().from(eodReports).where(eq(eodReports.reportOn, day));
  return new Map(rows.map((r) => [r.personnelId, r]));
}

/**
 * What the EOD form shows beside the boxes, for reference only: the person's plan for today with
 * what's finished, and their plan for the next work day.
 *
 * Input: the person, today, the rhythm. Output: the day they're planning next and both plans.
 */
export async function getEodReference(personnelId: string, today: string, rhythm: TeamRhythm) {
  const nextDay = nextWorkDay(today, rhythm);
  const rows = await db
    .select({ planOn: teamTaskDayPlans.planOn, title: teamTasks.title, status: teamTasks.status, position: teamTaskDayPlans.position })
    .from(teamTaskDayPlans)
    .innerJoin(teamTasks, eq(teamTasks.id, teamTaskDayPlans.taskId))
    .where(and(eq(teamTaskDayPlans.personnelId, personnelId), inArray(teamTaskDayPlans.planOn, [today, nextDay])))
    .orderBy(teamTaskDayPlans.position);
  const plan = (day: string) => rows.filter((r) => r.planOn === day).map((r) => ({ title: r.title, done: r.status === DONE_STATUS }));
  return { nextDay, todayPlan: plan(today), nextPlan: plan(nextDay) };
}

/**
 * Saves a person's EOD for today. The first save sets the time it was sent; later edits keep it.
 *
 * Input: the person, today, what they wrote, and the moment. Output: the saved report.
 * Throws EodInputError when every box is empty.
 */
export async function saveEod(personnelId: string, today: string, fields: EodFields, now: Date): Promise<EodReport> {
  const trimmed: EodFields = {
    done: fields.done.trim(),
    slipped: fields.slipped.trim(),
    blockers: fields.blockers.trim(),
    needFromManager: fields.needFromManager.trim(),
    nextOutcome: fields.nextOutcome.trim(),
  };
  if (Object.values(trimmed).every((v) => v === "")) throw new EodInputError("Write your EOD first");

  const [row] = await db
    .insert(eodReports)
    .values({ personnelId, reportOn: today, ...trimmed, submittedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [eodReports.personnelId, eodReports.reportOn], set: { ...trimmed, updatedAt: now } })
    .returning();
  await db.insert(auditLog).values({ action: "saveEod", entityType: "eod_report", entityId: row.id, actorId: personnelId, payload: { reportOn: today } });
  return row;
}

async function reminderSentOn(): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, REMINDER_SENT_SETTING_KEY)).limit(1);
  return typeof row?.value === "string" ? row.value : null;
}

/**
 * Pings everyone on the team who hasn't written today's EOD, once, in #office. Does nothing when
 * reminders are off, on a day off, before the reminder time, or when it already went out today.
 *
 * Input: the moment. Output: who was pinged.
 */
export async function sendEodReminderIfDue(now: Date): Promise<{ sent: boolean; reminded: string[] }> {
  const rhythm = await getTeamRhythm();
  const today = teamDay(now);
  if (!rhythm.reminderOn || !isWorkDay(today, rhythm) || teamMinutesNow(now) < minutesOf(rhythm.reminderTime)) return { sent: false, reminded: [] };
  if ((await reminderSentOn()) === today) return { sent: false, reminded: [] };

  // Recorded before posting, so a retried cron run can't ping twice.
  await db
    .insert(appSettings)
    .values({ key: REMINDER_SENT_SETTING_KEY, value: today })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: today, updatedAt: now } });

  const [members, eods] = await Promise.all([listTeamMembers(), listEods(today)]);
  const missing = members.filter((m) => !eods.has(m.id));
  if (missing.length === 0) return { sent: true, reminded: [] };

  const names = missing.map((m) => (m.discordUserId ? `<@${m.discordUserId}>` : m.name)).join(" ");
  await postToOfficeChannel({
    content: `${names} your EOD is due at ${rhythm.eodDueTime}. Write it on Team Tasks: ${appUrl("/team")}`,
    mentionDiscordIds: missing.map((m) => m.discordUserId).filter((id): id is string => Boolean(id)),
    memberDiscordIds: members.map((m) => m.discordUserId).filter((id): id is string => Boolean(id)),
  });
  await db.insert(auditLog).values({ action: "sendEodReminder", entityType: "eod_report", entityId: today, payload: { reminded: missing.map((m) => m.id) } });
  return { sent: true, reminded: missing.map((m) => m.name) };
}

/**
 * Last week's EOD record per person, for the first summary of a new week: how many of the week's
 * work days they sent one, and how many of those were on time.
 *
 * Input: today, the members, the rhythm. Output: a line per member id, e.g. "4 of 6 sent, 3 on time".
 */
export async function lastWeekEodLines(today: string, members: TeamMember[], rhythm: TeamRhythm): Promise<Map<string, string>> {
  const lastWeekStart = addDays(weekStartOf(today), -7);
  const lastWeekEnd = addDays(lastWeekStart, 6);
  const workDays = Array.from({ length: 7 }, (_, i) => addDays(lastWeekStart, i)).filter((d) => isWorkDay(d, rhythm));
  const rows = await db
    .select()
    .from(eodReports)
    .where(and(gte(eodReports.reportOn, lastWeekStart), lte(eodReports.reportOn, lastWeekEnd)));
  return new Map(
    members.map((m) => {
      const own = rows.filter((r) => r.personnelId === m.id && workDays.includes(r.reportOn));
      const onTime = own.filter((r) => !isLateEod(r, rhythm)).length;
      return [m.id, `${own.length} of ${workDays.length} sent, ${onTime} on time`];
    })
  );
}

/** Whether today is the first work day of its week, when the summary adds last week's EOD record. */
export function isFirstWorkDayOfWeek(today: string, rhythm: TeamRhythm): boolean {
  const monday = weekStartOf(today);
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    if (isWorkDay(day, rhythm)) return day === today;
  }
  return false;
}
