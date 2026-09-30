// The fixed lists and date rules Team Tasks runs on. Imported by client components too, so nothing
// here touches the database.

/** What kind of work a task is. Also how the board is filtered by team. */
export const TEAM_TASK_AREAS = [
  { key: "ops", label: "Ops" },
  { key: "production", label: "Production" },
  { key: "curation", label: "Curation" },
  { key: "hiring", label: "Hiring" },
  { key: "hr", label: "HR" },
  { key: "marketing", label: "Marketing" },
  { key: "tech", label: "Tech" },
  { key: "finance", label: "Finance" },
] as const;
export type TeamTaskArea = (typeof TEAM_TASK_AREAS)[number]["key"];

export const TEAM_TASK_STATUSES = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "Doing" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
] as const;
export type TeamTaskStatus = (typeof TEAM_TASK_STATUSES)[number]["key"];

export const DONE_STATUS: TeamTaskStatus = "done";
export const DOING_STATUS: TeamTaskStatus = "doing";
export const BLOCKED_STATUS: TeamTaskStatus = "blocked";

/** Why a person got a Team Tasks notification. */
export const TEAM_NOTIFICATION_KINDS = ["mention", "assigned"] as const;
export type TeamNotificationKind = (typeof TEAM_NOTIFICATION_KINDS)[number];

/** A task nobody has touched for this many days is flagged on the board. */
export const STALE_AFTER_DAYS = 2;

/** The team works on India time: "today", due dates and the 7 pm summary all follow it. */
export const TEAM_TIMEZONE = "Asia/Kolkata";
// India has one offset all year, no daylight saving.
const TEAM_UTC_OFFSET = "+05:30";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isTeamTaskArea(value: string): value is TeamTaskArea {
  return TEAM_TASK_AREAS.some((a) => a.key === value);
}

export function isTeamTaskStatus(value: string): value is TeamTaskStatus {
  return TEAM_TASK_STATUSES.some((s) => s.key === value);
}

export function areaLabel(key: string): string {
  return TEAM_TASK_AREAS.find((a) => a.key === key)?.label ?? key;
}

export function statusLabel(key: string): string {
  return TEAM_TASK_STATUSES.find((s) => s.key === key)?.label ?? key;
}

/**
 * The calendar day a moment falls on in India.
 *
 * Input: a moment. Output: the day as "YYYY-MM-DD".
 */
export function teamDay(moment: Date): string {
  // en-CA formats a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(moment);
}

/**
 * The instants an India day starts and ends at, for filtering timestamps by day.
 *
 * Input: a day as "YYYY-MM-DD". Output: its first instant and the first instant of the next day.
 */
export function teamDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00${TEAM_UTC_OFFSET}`);
  return { start, end: new Date(start.getTime() + MS_PER_DAY) };
}

/** The weekday of a "YYYY-MM-DD" day: 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/** A "YYYY-MM-DD" day moved by a number of days. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The Monday of the week a "YYYY-MM-DD" day is in. */
export function weekStartOf(day: string): string {
  const MONDAY = 1;
  const offset = (weekdayOf(day) - MONDAY + 7) % 7;
  return addDays(day, -offset);
}

export interface TaskSignals {
  overdue: boolean;
  dueToday: boolean;
  /** Not touched for STALE_AFTER_DAYS or more. */
  stale: boolean;
}

/**
 * The flags the board shows on a card without anyone setting them: overdue, due today, stale.
 * Done tasks carry none.
 *
 * Input: the task's status, due day and last activity, today's day, and the current moment.
 * Output: the three flags.
 */
export function taskSignals(
  task: { status: string; dueOn: string | null; lastActivityAt: Date | string },
  today: string,
  now: Date
): TaskSignals {
  if (task.status === DONE_STATUS) return { overdue: false, dueToday: false, stale: false };
  const lastActivity = new Date(task.lastActivityAt).getTime();
  return {
    overdue: task.dueOn !== null && task.dueOn < today,
    dueToday: task.dueOn === today,
    stale: now.getTime() - lastActivity >= STALE_AFTER_DAYS * MS_PER_DAY,
  };
}
