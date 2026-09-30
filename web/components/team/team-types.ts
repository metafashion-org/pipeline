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
export type BoardView = Serialized<TeamBoard> & { viewerId: string | null; unread: number };
export type TaskDetailView = Serialized<TeamTaskDetail>;
export type WeekView = Serialized<TeamWeek>;
export type LinkOptionsView = TeamLinkOptions;
export type SearchHitView = Serialized<TeamTaskSearchHit>;
export type NotificationView = Serialized<TeamNotificationRow>;

// app/api/team/board/route.ts: the whole board, refetched after every change.
export const TEAM_BOARD_URL = "/api/team/board";

export function taskDetailUrl(taskId: string): string {
  return `/api/team/tasks/${taskId}`;
}
