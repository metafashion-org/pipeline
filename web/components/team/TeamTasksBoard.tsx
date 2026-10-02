"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Columns3, Users } from "lucide-react";
import { jsonFetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { DONE_STATUS, TEAM_TASK_AREAS } from "@/lib/team-tasks/task-rules";
import { NewTaskDialog } from "./NewTaskDialog";
import { NotificationsBell } from "./NotificationsBell";
import { OfficeChannelButton } from "./OfficeChannelButton";
import { PersonColumn, columnLists } from "./PersonColumn";
import { RecurringDialog } from "./RecurringDialog";
import { StatusColumns } from "./StatusColumns";
import { TaskSearch } from "./TaskSearch";
import { TaskSheet } from "./TaskSheet";
import { TodayStrip } from "./TodayStrip";
import { WeekDialog } from "./WeekDialog";
import { setQueueOrder, setTodayPlan, updateTask } from "./team-actions";
import { TEAM_BOARD_URL, type BoardView, type TaskView } from "./team-types";

// Refetches the board on its own, so what others change shows up without a reload.
const BOARD_REFRESH_MS = 60_000;
const ALL_AREAS = "all";
const VIEWS = ["people", "status"] as const;
type BoardViewMode = (typeof VIEWS)[number];

/**
 * Team Tasks: what each person on the full-time team is on today and what's next. The top row is
 * everyone's plan for today; below, one column per person (or per status). The open task is in
 * the URL (?task=<id>), which is where email and Discord notices link to.
 */
export function TeamTasksBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openTaskId = searchParams.get("task");
  const { data: board, error, mutate } = useSWR<BoardView>(TEAM_BOARD_URL, jsonFetcher, { refreshInterval: BOARD_REFRESH_MS });
  const [view, setView] = useState<BoardViewMode>("people");
  const [area, setArea] = useState<string>(ALL_AREAS);

  function openTask(taskId: string) {
    router.replace(`${pathname}?task=${taskId}`, { scroll: false });
  }
  function closeTask() {
    router.replace(pathname, { scroll: false });
  }
  async function refresh() {
    await mutate();
  }

  if (error) return <p className="text-sm text-red-400">Couldn&apos;t load Team Tasks: {error.message}</p>;
  if (!board) return <p className="text-sm text-muted-foreground">Loading...</p>;

  const now = new Date();
  const ownerNames = new Map(board.members.map((m) => [m.id, m.name]));
  const shownTasks = area === ALL_AREAS ? board.tasks : board.tasks.filter((t) => t.area === area);
  const shownIds = new Set(shownTasks.map((t) => t.id));
  const shownBoard: BoardView = { ...board, tasks: shownTasks, plans: board.plans.filter((p) => shownIds.has(p.taskId)) };

  async function toggleDone(task: TaskView) {
    if (await updateTask(task.id, { status: task.status === DONE_STATUS ? "todo" : DONE_STATUS })) await refresh();
  }
  async function savePlan(personnelId: string, taskIds: string[]) {
    await setTodayPlan(personnelId, taskIds);
    await refresh();
  }
  async function saveQueue(ownerId: string, taskIds: string[]) {
    await setQueueOrder(ownerId, taskIds);
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <NewTaskDialog members={board.members} viewerId={board.viewerId} onCreated={async () => refresh()} />
        <div className="flex rounded-md border p-0.5">
          {VIEWS.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", view === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {mode === "people" ? <Users className="h-3.5 w-3.5" /> : <Columns3 className="h-3.5 w-3.5" />}
              {mode === "people" ? "By person" : "By status"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {[{ key: ALL_AREAS, label: "All" }, ...TEAM_TASK_AREAS].map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setArea(a.key)}
              className={cn("rounded-full border px-2 py-0.5 text-xs", area === a.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <TaskSearch onOpenTask={openTask} />
          <WeekDialog today={board.today} onOpenTask={openTask} />
          <RecurringDialog members={board.members} today={board.today} onChanged={refresh} />
          <OfficeChannelButton />
          <NotificationsBell unread={board.unread} onOpenTask={openTask} onRead={refresh} />
        </div>
      </div>

      {board.members.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm">
          <p className="font-medium">Nobody is on the full-time team yet.</p>
          <p className="mt-1 text-muted-foreground">
            Give people the &quot;full-time team&quot; role on{" "}
            <Link href="/admin/personnel" className="text-primary hover:underline">
              Personnel
            </Link>
            . They become the columns here, and the people tasks can be given to.
          </p>
        </div>
      ) : (
        <>
          <TodayStrip board={shownBoard} onOpen={openTask} />
          {view === "people" ? (
            <div className="flex items-start gap-3 overflow-x-auto pb-4">
              {board.members.map((member) => {
                const lists = columnLists(shownBoard, member.id);
                return (
                  <PersonColumn
                    // Remounted whenever the member's lists change, so the column's drag state starts from the saved order.
                    key={`${member.id}:${lists.todayIds.join(",")}|${lists.nextIds.join(",")}`}
                    member={member}
                    board={shownBoard}
                    now={now}
                    ownerNames={ownerNames}
                    onOpen={openTask}
                    onToggleDone={toggleDone}
                    onSavePlan={savePlan}
                    onSaveQueue={saveQueue}
                  />
                );
              })}
            </div>
          ) : (
            <StatusColumns board={board} tasks={shownTasks} now={now} ownerNames={ownerNames} onOpen={openTask} onToggleDone={toggleDone} />
          )}
        </>
      )}

      {openTaskId && <TaskSheet key={openTaskId} taskId={openTaskId} board={board} onClose={closeTask} onChanged={refresh} />}
    </div>
  );
}
