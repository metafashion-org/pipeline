"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckSquare, Clock, GripVertical, Link2, Lock, MessageSquare, Sun, SunDim } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";
import { areaLabel, BLOCKED_STATUS, DOING_STATUS, DONE_STATUS, STALE_AFTER_DAYS, taskSignals } from "@/lib/team-tasks/task-rules";
import type { TaskView } from "./team-types";

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-none", className)}>{children}</span>;
}

/**
 * One Team Task on the board. The flags (overdue, due today, stale, blocked) come from the task
 * itself; nobody sets them.
 */
export function TeamTaskCard({
  task,
  today,
  now,
  number,
  ownerName,
  inToday,
  onOpen,
  onToggleDone,
  onToggleToday,
  planName = "today",
  dragHandle,
  className,
}: {
  task: TaskView;
  today: string;
  now: Date;
  /** Its place in today's plan, shown as "1.", "2." ... */
  number?: number;
  /** Shown when the card isn't in its owner's column. */
  ownerName?: string;
  inToday?: boolean;
  onOpen: () => void;
  onToggleDone: () => void;
  onToggleToday?: () => void;
  /** The day the sun button plans for: "today", "tomorrow" or e.g. "Mon 12 Oct". */
  planName?: string;
  /** The drag handle's listeners, when the card can be reordered. */
  dragHandle?: HTMLAttributes<HTMLButtonElement>;
  className?: string;
}) {
  const signals = taskSignals(task, today, now);
  const done = task.status === DONE_STATUS;
  const subtasksDone = task.subtasks.filter((s) => s.doneAt).length;

  return (
    <div
      className={cn(
        "group rounded-md border bg-card p-2 text-sm shadow-sm transition-colors hover:border-primary/50",
        task.status === DOING_STATUS && "border-l-2 border-l-sky-500",
        task.status === BLOCKED_STATUS && "border-l-2 border-l-red-500",
        done && "opacity-60",
        className
      )}
    >
      <div className="flex items-start gap-1.5">
        {dragHandle && (
          <button type="button" className="mt-0.5 cursor-grab text-muted-foreground/60 hover:text-foreground touch-none" aria-label="Drag to reorder" {...dragHandle}>
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <input
          type="checkbox"
          checked={done}
          onChange={onToggleDone}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary cursor-pointer"
          aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`}
        />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className={cn("block leading-snug", done && "line-through")}>
            {number !== undefined && <span className="mr-1 font-semibold text-primary">{number}.</span>}
            {task.isPrivate && <Lock className="mr-1 inline h-3 w-3 text-muted-foreground" aria-label="Private" />}
            {task.title}
          </span>
        </button>
        {onToggleToday && !done && (
          <button
            type="button"
            onClick={onToggleToday}
            className={cn("shrink-0 rounded p-0.5", inToday ? "text-amber-400" : "text-muted-foreground/50 opacity-0 group-hover:opacity-100 focus:opacity-100")}
            title={inToday ? `Take off the plan for ${planName}` : `Add to the plan for ${planName}`}
            aria-label={inToday ? `Take ${task.title} off the plan for ${planName}` : `Add ${task.title} to the plan for ${planName}`}
          >
            {inToday ? <Sun className="h-3.5 w-3.5" /> : <SunDim className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <button type="button" onClick={onOpen} className="mt-1.5 flex w-full flex-wrap items-center gap-1 text-left">
        <Chip className="bg-muted text-muted-foreground">{areaLabel(task.area)}</Chip>
        {ownerName && <Chip className="bg-muted text-muted-foreground">{ownerName}</Chip>}
        {task.status === DOING_STATUS && <Chip className="bg-sky-500/15 text-sky-400">Doing</Chip>}
        {task.targetCount !== null && (
          <Chip className={cn(task.doneCount >= task.targetCount ? "bg-emerald-500/15 text-emerald-400" : "bg-violet-500/15 text-violet-300")}>
            {task.doneCount}/{task.targetCount}
            {task.focus ? ` · ${task.focus}` : ""}
          </Chip>
        )}
        {task.dueOn && !done && (
          <Chip className={cn(signals.overdue ? "bg-red-500/15 text-red-400" : signals.dueToday ? "bg-amber-500/15 text-amber-400" : "bg-muted text-muted-foreground")}>
            <Clock className="h-3 w-3" />
            {signals.overdue ? `Overdue ${formatDate(task.dueOn)}` : signals.dueToday ? "Due today" : `Due ${formatDate(task.dueOn)}`}
          </Chip>
        )}
        {task.subtasks.length > 0 && (
          <Chip className="bg-muted text-muted-foreground">
            <CheckSquare className="h-3 w-3" />
            {subtasksDone}/{task.subtasks.length}
          </Chip>
        )}
        {task.linkCount > 0 && (
          <Chip className="bg-muted text-muted-foreground">
            <Link2 className="h-3 w-3" />
            {task.linkCount}
          </Chip>
        )}
        {task.commentCount > 0 && (
          <Chip className="bg-muted text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            {task.commentCount}
          </Chip>
        )}
        {signals.stale && (
          <Chip className="bg-amber-500/10 text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            No update in {STALE_AFTER_DAYS}+ days
          </Chip>
        )}
      </button>

      {task.status === BLOCKED_STATUS && (
        <p className="mt-1 text-xs text-red-400">Blocked{task.waitingOn ? `: waiting on ${task.waitingOn}` : ""}</p>
      )}
      {task.latestUpdate && (
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
          {task.latestUpdate.authorName ? `${task.latestUpdate.authorName}: ` : ""}
          {task.latestUpdate.body}
        </p>
      )}
    </div>
  );
}
