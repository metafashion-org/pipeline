"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOING_STATUS, DONE_STATUS } from "@/lib/team-tasks/task-rules";
import type { BoardView, TaskView } from "./team-types";

/**
 * The row across the top of Team Tasks: for each person, what they're doing right now and their
 * plan for today in order, with what's finished ticked.
 */
export function TodayStrip({ board, onOpen }: { board: BoardView; onOpen: (taskId: string) => void }) {
  const byId = new Map(board.tasks.map((t) => [t.id, t]));
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {board.members.map((member) => {
        const plan = board.plans.filter((p) => p.personnelId === member.id).map((p) => byId.get(p.taskId)).filter((t): t is TaskView => t !== undefined);
        const doing = board.tasks.filter((t) => t.ownerId === member.id && t.status === DOING_STATUS);
        const doneCount = plan.filter((t) => t.status === DONE_STATUS).length;
        return (
          <div key={member.id} className="w-[260px] shrink-0 rounded-lg border bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-semibold">{member.name}</p>
              {plan.length > 0 && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {doneCount}/{plan.length} done
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Now:{" "}
              {doing.length > 0 ? (
                <button type="button" className="text-sky-400 hover:underline" onClick={() => onOpen(doing[0].id)}>
                  {doing[0].title}
                  {doing.length > 1 ? ` +${doing.length - 1}` : ""}
                </button>
              ) : (
                "nothing marked Doing"
              )}
            </p>
            {plan.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No plan for today yet.</p>
            ) : (
              <ol className="mt-2 space-y-0.5">
                {plan.map((task, index) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(task.id)}
                      className={cn("flex w-full items-start gap-1.5 text-left text-xs hover:underline", task.status === DONE_STATUS && "text-muted-foreground line-through")}
                    >
                      <span className="w-4 shrink-0 text-right font-semibold text-primary">{index + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      {task.status === DONE_STATUS && <Check className="h-3 w-3 shrink-0 text-emerald-400" />}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}
