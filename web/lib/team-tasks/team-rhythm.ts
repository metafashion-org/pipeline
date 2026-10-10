// The team's daily rhythm: how far ahead people plan, which days are work days, when the EOD is
// due, when the 7 pm summary goes out and whether people who haven't written their EOD get a
// reminder first. Stored as one app_settings row so an admin can change it in Settings while the
// routine is being tried out, without a deploy.

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { addDays, weekdayOf } from "./task-rules";

const RHYTHM_SETTING_KEY = "team_rhythm";
// Longest plan-ahead window Settings accepts: two weeks.
const MAX_PLAN_AHEAD_DAYS = 14;
// How many days are scanned to find the next work day; a week covers any set of work days.
const DAYS_IN_WEEK = 7;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TeamRhythmSchema = z.object({
  /** How many work days after today people can plan, e.g. 5 = the rest of the week. */
  planAheadDays: z.number().int().min(1).max(MAX_PLAN_AHEAD_DAYS),
  /** Work days, 0 = Sunday ... 6 = Saturday. The day after the last one plans the next first one. */
  workDays: z.array(z.number().int().min(0).max(6)).min(1),
  /** India time the EOD is due by, "HH:MM". Sent after it is marked late. */
  eodDueTime: z.string().regex(TIME_PATTERN),
  /** India time the summary with everyone's EOD is emailed to the team, "HH:MM". */
  summaryTime: z.string().regex(TIME_PATTERN),
  reminderOn: z.boolean(),
  /** India time people without an EOD are pinged in #office, "HH:MM". */
  reminderTime: z.string().regex(TIME_PATTERN),
});
export type TeamRhythm = z.infer<typeof TeamRhythmSchema>;

export const DEFAULT_TEAM_RHYTHM: TeamRhythm = {
  planAheadDays: 6,
  // Monday to Saturday: the office works Saturdays, and Saturday's plan is for Monday.
  workDays: [1, 2, 3, 4, 5, 6],
  eodDueTime: "18:30",
  summaryTime: "19:00",
  reminderOn: true,
  reminderTime: "18:15",
};

/** The saved rhythm, or the defaults for any setting not saved yet. */
export async function getTeamRhythm(): Promise<TeamRhythm> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, RHYTHM_SETTING_KEY)).limit(1);
  const parsed = TeamRhythmSchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_TEAM_RHYTHM, ...(parsed.success ? parsed.data : {}) };
}

/** Saves the whole rhythm and logs who changed it. */
export async function saveTeamRhythm(rhythm: TeamRhythm, actorId: string | null): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: RHYTHM_SETTING_KEY, value: rhythm, updatedBy: actorId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: rhythm, updatedBy: actorId, updatedAt: new Date() } });
  await db.insert(auditLog).values({ action: "saveTeamRhythm", entityType: "app_setting", entityId: RHYTHM_SETTING_KEY, actorId, payload: rhythm });
}

/** Whether a "YYYY-MM-DD" day is a work day. */
export function isWorkDay(day: string, rhythm: TeamRhythm): boolean {
  return rhythm.workDays.includes(weekdayOf(day));
}

/** The first work day after a day: Saturday's is Monday when Sunday is off. */
export function nextWorkDay(day: string, rhythm: TeamRhythm): string {
  for (let step = 1; step <= DAYS_IN_WEEK; step++) {
    const candidate = addDays(day, step);
    if (isWorkDay(candidate, rhythm)) return candidate;
  }
  return addDays(day, 1);
}

/**
 * The days people can plan from the board: today, then the next planAheadDays work days.
 *
 * Input: today and the rhythm. Output: the days, in order, today first.
 */
export function planDays(today: string, rhythm: TeamRhythm): string[] {
  const days = [today];
  let day = today;
  for (let count = 0; count < rhythm.planAheadDays; count++) {
    day = nextWorkDay(day, rhythm);
    days.push(day);
  }
  return days;
}

/** Minutes since midnight of an "HH:MM" time. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
