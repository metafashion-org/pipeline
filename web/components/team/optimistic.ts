// What a Team Tasks change looks like before the server confirms it, so the screen updates the
// moment someone clicks instead of after the save and a full board reload (about 2 seconds).
// SWR shows these immediately and puts the old data back if the save fails.

import { DONE_STATUS } from "@/lib/team-tasks/task-rules";
import type { BoardView, TaskDetailView, TaskView } from "./team-types";

type SubtaskView = TaskView["subtasks"][number];

/** The task fields a PATCH can change, applied to a task as it's shown. */
export function applyTaskPatch<T extends TaskView>(task: T, fields: Record<string, unknown>, ownerName?: string): T {
  const next = { ...task, ...fields } as T;
  if (typeof fields.status === "string") {
    next.completedAt = fields.status === DONE_STATUS ? new Date().toISOString() : null;
  }
  if ("ownerName" in task && typeof fields.ownerId === "string" && ownerName) {
    (next as T & { ownerName: string }).ownerName = ownerName;
  }
  return next;
}

/** The board with one task changed. */
export function boardWithTask(board: BoardView, taskId: string, fields: Record<string, unknown>): BoardView {
  return { ...board, tasks: board.tasks.map((t) => (t.id === taskId ? applyTaskPatch(t, fields) : t)) };
}

/** A task's detail with its fields changed. */
export function detailWithTask(detail: TaskDetailView, fields: Record<string, unknown>, ownerName?: string): TaskDetailView {
  return { ...detail, task: applyTaskPatch(detail.task, fields, ownerName) };
}

/** A task's detail with one subtask changed ({ done } becomes doneAt), or removed when patch is null. */
export function detailWithSubtask(detail: TaskDetailView, subtaskId: string, patch: Record<string, unknown> | null): TaskDetailView {
  const subtasks: SubtaskView[] =
    patch === null
      ? detail.task.subtasks.filter((s) => s.id !== subtaskId)
      : detail.task.subtasks.map((s) => {
          if (s.id !== subtaskId) return s;
          const { done, ...rest } = patch;
          const next = { ...s, ...rest } as SubtaskView;
          if (typeof done === "boolean") next.doneAt = done ? new Date().toISOString() : null;
          return next;
        });
  return { ...detail, task: { ...detail.task, subtasks } };
}
