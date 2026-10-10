import type { BoardTask, TeamBoard, TeamTaskDetail, TeamWeek, TeamLinkOptions, TeamTaskSearchHit } from "@/lib/team-tasks/team-board";
import type { TeamNotificationRow } from "@/lib/team-tasks/team-notifications";

/** A server type as it arrives over JSON: every Date is an ISO string. */
export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export type TaskView = Serialized<BoardTask>;
export type BoardView = Serialized<TeamBoard> & {
  viewerId: string | null;
  unread: number;
  /** The days that can be planned: today, then the plan-ahead work days set in Settings. */
  planDays: string[];
  /** Who on the team has sent today's EOD. */
  eodSentIds: string[];
  /** "HH:MM", India time. */
  eodDueTime: string;
};
export type TaskDetailView = Serialized<TeamTaskDetail>;
export type WeekView = Serialized<TeamWeek>;
export type LinkOptionsView = TeamLinkOptions;
export type SearchHitView = Serialized<TeamTaskSearchHit>;
export type NotificationView = Serialized<TeamNotificationRow>;

// app/api/team/board/route.ts: the whole board, refetched after every change.
export const TEAM_BOARD_URL = "/api/team/board";

/** The board for one plan day; today's board is the plain URL. */
export function boardUrlFor(planDay: string | null): string {
  return planDay ? `${TEAM_BOARD_URL}?planDay=${encodeURIComponent(planDay)}` : TEAM_BOARD_URL;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A plan day as the board names it: "today", "tomorrow", or e.g. "Mon 12 Oct".
 *
 * Input: the day and today, both "YYYY-MM-DD". Output: the name, lowercase for today and tomorrow.
 */
export function planDayName(day: string, today: string): string {
  if (day === today) return "today";
  const [year, month, date] = day.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, date));
  const [ty, tm, td] = today.split("-").map(Number);
  // One day in milliseconds, to tell tomorrow from later days.
  const ONE_DAY_MS = 86_400_000;
  if (at.getTime() - Date.UTC(ty, tm - 1, td) === ONE_DAY_MS) return "tomorrow";
  return `${WEEKDAY_NAMES[at.getUTCDay()]} ${date} ${MONTH_NAMES[month - 1]}`;
}

export function taskDetailUrl(taskId: string): string {
  return `/api/team/tasks/${taskId}`;
}
