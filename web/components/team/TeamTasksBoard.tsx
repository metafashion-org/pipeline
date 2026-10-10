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
import { setDayPlan, setQueueOrder, updateTask } from "./team-actions";
import { boardUrlFor, planDayName, type BoardView, type TaskView } from "./team-types";
import { EodDialog } from "./EodDialog";
import { boardWithTask } from "./optimistic";

// Refetches the board on its own, so what others change shows up without a reload.
const BOARD_REFRESH_MS = 60_000;
const ALL_AREAS = "all";
const VIEWS = ["people", "status"] as const;
type BoardViewMode = (typeof VIEWS)[number];

/**
 * Team Tasks: what each person on the full-time team is on today and what's next. The top row is
 * everyone's plan for the picked day (today, or a later day being planned ahead); below, one column
 * per person (or per status). The open task is in the URL (?task=<id>), which is where email and
 * Discord notices link to.
 */
export function TeamTasksBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openTaskId = searchParams.get("task");
  // The day whose plans the board shows and edits; null is today.
  const [planDay, setPlanDay] = useState<string | null>(null);
  const { data: board, error, mutate } = useSWR<BoardView>(boardUrlFor(planDay), jsonFetcher, {
    refreshInterval: BOARD_REFRESH_MS,
    // Keeps the old board on screen while another day's plans load, instead of a blank page.
    keepPreviousData: true,
  });
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

  // Shows a change on the board at once and saves it in the background. If the save fails, the
  // board goes back to how it was and the save's own toast says why.
  async function saveShown(write: () => Promise<boolean>, preview: (current: BoardView) => BoardView) {
    try {
      await mutate(
        async () => {
          if (!(await write())) throw new Error("not saved");
          return undefined;
        },
        { optimisticData: (current) => preview(current as BoardView), rollbackOnError: true, populateCache: false, revalidate: true }
      );
    } catch {
      // The failed write already showed its error.
    }
  }
  function toggleDone(task: TaskView) {
    const status = task.status === DONE_STATUS ? "todo" : DONE_STATUS;
    return saveShown(() => updateTask(task.id, { status }), (current) => boardWithTask(current, task.id, { status }));
  }
  function savePlan(personnelId: string, taskIds: string[]) {
    return saveShown(
      () => setDayPlan(personnelId, board!.planDay, taskIds),
      (current) => ({
        ...current,
        plans: [...current.plans.filter((p) => p.personnelId !== personnelId), ...taskIds.map((taskId, position) => ({ personnelId, taskId, position }))],
      })
    );
  }
  function saveQueue(ownerId: string, taskIds: string[]) {
    const order = new Map(taskIds.map((id, index) => [id, index]));
    return saveShown(
      () => setQueueOrder(ownerId, taskIds),
      (current) => ({ ...current, tasks: current.tasks.map((t) => (order.has(t.id) ? { ...t, position: order.get(t.id) as number } : t)) })
    );
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
          {board.viewerId && board.members.some((m) => m.id === board.viewerId) && (
            <EodDialog sent={board.eodSentIds.includes(board.viewerId)} dueTime={board.eodDueTime} onSaved={refresh} />
          )}
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
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Planning for</span>
            {board.planDays.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => setPlanDay(day === board.today ? null : day)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs capitalize",
                  day === board.planDay ? "border-amber-400 bg-amber-400/15 text-amber-300" : "hover:bg-muted"
                )}
              >
                {planDayName(day, board.today)}
              </button>
            ))}
          </div>
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
