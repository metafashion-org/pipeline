"use client";

import { useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DONE_STATUS } from "@/lib/team-tasks/task-rules";
import type { TeamMember } from "@/lib/team-tasks/team-members";
import { TeamTaskCard } from "./TeamTaskCard";
import { planDayName, type BoardView, type TaskView } from "./team-types";

// The two lists in a column that cards can be dragged within and between.
const TODAY_LIST = "today";
const NEXT_LIST = "next";
type ListKey = typeof TODAY_LIST | typeof NEXT_LIST;

/** A person's lists, worked out from the board: today's plan, the rest of their open work, and more. */
export function columnLists(board: BoardView, memberId: string) {
  const byId = new Map(board.tasks.map((t) => [t.id, t]));
  const todayIds = board.plans.filter((p) => p.personnelId === memberId && byId.has(p.taskId)).map((p) => p.taskId);
  const inToday = new Set(todayIds);
  const nextIds = board.tasks
    .filter((t) => t.ownerId === memberId && t.status !== DONE_STATUS && !inToday.has(t.id))
    .sort((a, b) => a.position - b.position)
    .map((t) => t.id);
  const helping = board.tasks.filter((t) => t.status !== DONE_STATUS && t.ownerId !== memberId && t.helperIds.includes(memberId) && !inToday.has(t.id));
  const theirSubtasks = board.tasks
    .filter((t) => t.status !== DONE_STATUS && t.ownerId !== memberId)
    .flatMap((t) => t.subtasks.filter((s) => s.ownerId === memberId && !s.doneAt).map((subtask) => ({ subtask, task: t })));
  const doneToday = board.tasks.filter((t) => t.ownerId === memberId && t.status === DONE_STATUS && !inToday.has(t.id));
  return { todayIds, nextIds, helping, theirSubtasks, doneToday };
}

function SortableTask({ id, children }: { id: string; children: (handle: Record<string, unknown>) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-50")}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

// A list's drop area, so a card can be dropped into it even when it's empty.
function DropList({ id, empty, children }: { id: ListKey; empty: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("min-h-10 space-y-1.5 rounded-md p-0.5 transition-colors", isOver && "bg-primary/5")}>
      {children}
      {empty && <p className="px-1 py-2 text-xs text-muted-foreground">{empty}</p>}
    </div>
  );
}

function Section({ title, count, children, collapsible = false }: { title: string; count?: number; children: ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  const heading = (
    <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {collapsible && (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
      {title}
      {count !== undefined && <span className="font-normal">({count})</span>}
    </span>
  );
  return (
    <div className="space-y-1.5">
      {collapsible ? (
        <button type="button" onClick={() => setOpen((v) => !v)}>
          {heading}
        </button>
      ) : (
        heading
      )}
      {open && children}
    </div>
  );
}

/**
 * One person's column: today's plan (numbered, in order), then the rest of their open tasks in
 * order of importance. Drag to reorder either list, or between them to add to or take off today.
 * Below: tasks they help on, checklist items given to them on other people's tasks, and what they
 * finished today.
 */
export function PersonColumn({
  member,
  board,
  now,
  ownerNames,
  onOpen,
  onToggleDone,
  onSavePlan,
  onSaveQueue,
}: {
  member: TeamMember;
  board: BoardView;
  now: Date;
  ownerNames: Map<string, string>;
  onOpen: (taskId: string) => void;
  onToggleDone: (task: TaskView) => void;
  onSavePlan: (personnelId: string, taskIds: string[]) => void;
  onSaveQueue: (ownerId: string, taskIds: string[]) => void;
}) {
  const computed = columnLists(board, member.id);
  // Held locally while dragging so the card lands where it's dropped before the save comes back.
  // The parent remounts the column (key) whenever the board's lists change.
  const [lists, setLists] = useState<Record<ListKey, string[]>>({ [TODAY_LIST]: computed.todayIds, [NEXT_LIST]: computed.nextIds });
  const byId = new Map(board.tasks.map((t) => [t.id, t]));
  const dayName = planDayName(board.planDay, board.today);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function listOf(id: string): ListKey | null {
    if (id === TODAY_LIST || lists[TODAY_LIST].includes(id)) return TODAY_LIST;
    if (id === NEXT_LIST || lists[NEXT_LIST].includes(id)) return NEXT_LIST;
    return null;
  }

  // The owner's open tasks in queue order: today's own tasks first, then the rest.
  function queueFrom(next: Record<ListKey, string[]>): string[] {
    return [...next[TODAY_LIST].filter((id) => byId.get(id)?.ownerId === member.id && byId.get(id)?.status !== DONE_STATUS), ...next[NEXT_LIST]];
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    const from = listOf(activeId);
    const to = listOf(overId);
    if (!from || !to) return;

    let next: Record<ListKey, string[]>;
    if (from === to) {
      const oldIndex = lists[from].indexOf(activeId);
      const newIndex = overId === to ? lists[to].length - 1 : lists[to].indexOf(overId);
      if (oldIndex === newIndex) return;
      next = { ...lists, [from]: arrayMove(lists[from], oldIndex, newIndex) };
    } else {
      const target = lists[to].filter((id) => id !== activeId);
      const at = overId === to ? target.length : Math.max(0, target.indexOf(overId));
      target.splice(at, 0, activeId);
      next = { ...lists, [from]: lists[from].filter((id) => id !== activeId), [to]: target };
    }
    setLists(next);
    if (from === TODAY_LIST || to === TODAY_LIST) onSavePlan(member.id, next[TODAY_LIST]);
    if (from === NEXT_LIST || to === NEXT_LIST) onSaveQueue(member.id, queueFrom(next));
  }

  function toggleToday(taskId: string) {
    const inToday = lists[TODAY_LIST].includes(taskId);
    const next = inToday
      ? { [TODAY_LIST]: lists[TODAY_LIST].filter((id) => id !== taskId), [NEXT_LIST]: byId.get(taskId)?.ownerId === member.id ? [taskId, ...lists[NEXT_LIST]] : lists[NEXT_LIST] }
      : { [TODAY_LIST]: [...lists[TODAY_LIST], taskId], [NEXT_LIST]: lists[NEXT_LIST].filter((id) => id !== taskId) };
    setLists(next);
    onSavePlan(member.id, next[TODAY_LIST]);
  }

  function card(taskId: string, list: ListKey, handle: Record<string, unknown>, index: number) {
    const task = byId.get(taskId);
    if (!task) return null;
    return (
      <TeamTaskCard
        task={task}
        today={board.today}
        now={now}
        number={list === TODAY_LIST ? index + 1 : undefined}
        ownerName={task.ownerId !== member.id ? ownerNames.get(task.ownerId) : undefined}
        inToday={list === TODAY_LIST}
        onOpen={() => onOpen(task.id)}
        onToggleDone={() => onToggleDone(task)}
        onToggleToday={() => toggleToday(task.id)}
        planName={dayName}
        dragHandle={handle}
      />
    );
  }

  const openCount = board.tasks.filter((t) => t.ownerId === member.id && t.status !== DONE_STATUS).length;

  return (
    <div className="flex w-[280px] shrink-0 flex-col gap-3 rounded-lg border bg-muted/20 p-2.5">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h3 className="truncate text-sm font-semibold">{member.name}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {openCount} open · {computed.doneToday.length + lists[TODAY_LIST].filter((id) => byId.get(id)?.status === DONE_STATUS).length} done today
        </span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <Section title={dayName.charAt(0).toUpperCase() + dayName.slice(1)}>
          <SortableContext id={TODAY_LIST} items={lists[TODAY_LIST]} strategy={verticalListSortingStrategy}>
            <DropList id={TODAY_LIST} empty={lists[TODAY_LIST].length === 0 ? `Nothing planned for ${dayName} yet. Drag tasks here or tap the sun on a card.` : ""}>
              {lists[TODAY_LIST].map((id, index) => (
                <SortableTask key={id} id={id}>
                  {(handle) => card(id, TODAY_LIST, handle, index)}
                </SortableTask>
              ))}
            </DropList>
          </SortableContext>
        </Section>

        <Section title="Next" count={lists[NEXT_LIST].length}>
          <SortableContext id={NEXT_LIST} items={lists[NEXT_LIST]} strategy={verticalListSortingStrategy}>
            <DropList id={NEXT_LIST} empty={lists[NEXT_LIST].length === 0 ? "Nothing else open." : ""}>
              {lists[NEXT_LIST].map((id, index) => (
                <SortableTask key={id} id={id}>
                  {(handle) => card(id, NEXT_LIST, handle, index)}
                </SortableTask>
              ))}
            </DropList>
          </SortableContext>
        </Section>
      </DndContext>

      {computed.helping.length > 0 && (
        <Section title="Helping on" count={computed.helping.length}>
          {computed.helping.map((task) => (
            <TeamTaskCard
              key={task.id}
              task={task}
              today={board.today}
              now={now}
              ownerName={ownerNames.get(task.ownerId)}
              onOpen={() => onOpen(task.id)}
              onToggleDone={() => onToggleDone(task)}
              onToggleToday={() => toggleToday(task.id)}
              planName={dayName}
            />
          ))}
        </Section>
      )}

      {computed.theirSubtasks.length > 0 && (
        <Section title="Subtasks given to them" count={computed.theirSubtasks.length}>
          <ul className="space-y-1">
            {computed.theirSubtasks.map(({ subtask, task }) => (
              <li key={subtask.id}>
                <button type="button" onClick={() => onOpen(task.id)} className="w-full rounded-md border bg-card px-2 py-1.5 text-left text-xs hover:border-primary/50">
                  <span className="block">{subtask.title}</span>
                  <span className="block text-muted-foreground">
                    on {task.title} · {ownerNames.get(task.ownerId)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {computed.doneToday.length > 0 && (
        <Section title="Done today" count={computed.doneToday.length} collapsible>
          {computed.doneToday.map((task) => (
            <TeamTaskCard key={task.id} task={task} today={board.today} now={now} onOpen={() => onOpen(task.id)} onToggleDone={() => onToggleDone(task)} />
          ))}
        </Section>
      )}
    </div>
  );
}
