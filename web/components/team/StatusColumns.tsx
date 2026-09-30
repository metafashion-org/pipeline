"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TEAM_TASK_STATUSES, DONE_STATUS } from "@/lib/team-tasks/task-rules";
import { TeamTaskCard } from "./TeamTaskCard";
import type { BoardView, TaskView } from "./team-types";

const SORTS = [
  { key: "priority", label: "Owner's order" },
  { key: "due", label: "Due date" },
  { key: "owner", label: "Owner" },
  { key: "area", label: "Kind of task" },
  { key: "updated", label: "Last update" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];
// Tasks with no due date sort after every dated one.
const NO_DUE_DATE = "9999-12-31";

function sortTasks(tasks: TaskView[], sort: SortKey, ownerNames: Map<string, string>): TaskView[] {
  const sorted = [...tasks];
  switch (sort) {
    case "priority":
      return sorted.sort((a, b) => (ownerNames.get(a.ownerId) ?? "").localeCompare(ownerNames.get(b.ownerId) ?? "") || a.position - b.position);
    case "due":
      return sorted.sort((a, b) => (a.dueOn ?? NO_DUE_DATE).localeCompare(b.dueOn ?? NO_DUE_DATE));
    case "owner":
      return sorted.sort((a, b) => (ownerNames.get(a.ownerId) ?? "").localeCompare(ownerNames.get(b.ownerId) ?? ""));
    case "area":
      return sorted.sort((a, b) => a.area.localeCompare(b.area));
    case "updated":
      return sorted.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }
}

/** The board by status: To do, Doing, Blocked, and Done today, each sortable. */
export function StatusColumns({
  board,
  tasks,
  now,
  ownerNames,
  onOpen,
  onToggleDone,
}: {
  board: BoardView;
  /** The tasks to show, already filtered by kind of task. */
  tasks: TaskView[];
  now: Date;
  ownerNames: Map<string, string>;
  onOpen: (taskId: string) => void;
  onToggleDone: (task: TaskView) => void;
}) {
  const [sort, setSort] = useState<SortKey>("priority");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort by</span>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {TEAM_TASK_STATUSES.map((status) => {
          const inColumn = sortTasks(
            tasks.filter((t) => t.status === status.key),
            sort,
            ownerNames
          );
          return (
            <div key={status.key} className="flex w-[280px] shrink-0 flex-col gap-2 rounded-lg border bg-muted/20 p-2.5">
              <h3 className="flex items-baseline justify-between text-sm font-semibold">
                {status.key === DONE_STATUS ? "Done today" : status.label}
                <span className="text-xs font-normal text-muted-foreground">{inColumn.length}</span>
              </h3>
              {inColumn.length === 0 && <p className="text-xs text-muted-foreground">Nothing here.</p>}
              {inColumn.map((task) => (
                <TeamTaskCard
                  key={task.id}
                  task={task}
                  today={board.today}
                  now={now}
                  ownerName={ownerNames.get(task.ownerId)}
                  onOpen={() => onOpen(task.id)}
                  onToggleDone={() => onToggleDone(task)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
