"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import Link from "next/link";
import { BookOpen, KanbanSquare, ListChecks, Minus, Plus, Sun, SunDim, Trash2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { jsonFetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { areaLabel, statusLabel, BLOCKED_STATUS, DONE_STATUS, TEAM_TASK_AREAS, TEAM_TASK_STATUSES } from "@/lib/team-tasks/task-rules";
import type { TeamMember } from "@/lib/team-tasks/team-members";
import { MentionInput } from "./MentionInput";
import { addComment, addLink, addSubtask, deleteSubtask, removeLink, setTodayPlan, updateSubtask, updateTask } from "./team-actions";
import { taskDetailUrl, type BoardView, type LinkOptionsView, type TaskDetailView } from "./team-types";

// A Select can't hold an empty value, so "nobody" has its own.
const NOBODY = "__nobody__";
const LINK_SEARCH_MIN_CHARS = 2;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

// One line of the task's history, from its audit_log rows.
function describeHistory(entry: TaskDetailView["history"][number], names: Map<string, string>): string {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case "createTeamTask":
      return "made the task";
    case "makeRecurringTask":
      return "made it from a repeating task";
    case "updateTeamTask": {
      const changed = (payload.changed ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const parts = Object.entries(changed).map(([field, change]) => {
        if (field === "status") return `moved it to ${statusLabel(String(change.to))}`;
        if (field === "ownerId") return `gave it to ${names.get(String(change.to)) ?? "someone"}`;
        if (field === "doneCount") return `set the count to ${String(change.to)}`;
        if (field === "dueOn") return change.to ? `set it due ${formatDate(String(change.to))}` : "cleared the due date";
        if (field === "helperIds") return "changed the helpers";
        if (field === "area") return `made it ${areaLabel(String(change.to))}`;
        return `changed the ${field === "notes" ? "notes" : field}`;
      });
      return parts.length > 0 ? parts.join(", ") : "edited it";
    }
    case "addTeamSubtask":
      return `added the subtask "${String(payload.title ?? "")}"`;
    case "updateTeamSubtask":
      return payload.done === true ? "ticked a subtask" : payload.done === false ? "unticked a subtask" : "changed a subtask";
    case "deleteTeamSubtask":
      return `removed the subtask "${String(payload.title ?? "")}"`;
    case "addTeamTaskLink":
      return "added a link";
    case "removeTeamTaskLink":
      return "removed a link";
    case "commentTeamTask":
      return "posted an update";
    default:
      return entry.action;
  }
}

const LINK_ICONS = { task: ListChecks, asset: KanbanSquare, artifact: BookOpen } as const;

// Search for something to link: other tasks, assets by SKU or name, Registry items by ID or title.
function LinkPicker({ taskId, onLinked }: { taskId: string; onLinked: () => void }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const { data } = useSWR<LinkOptionsView>(
    trimmed.length >= LINK_SEARCH_MIN_CHARS ? `/api/team/link-options?q=${encodeURIComponent(trimmed)}&from=${taskId}` : null,
    jsonFetcher
  );
  async function pick(kind: "task" | "asset" | "artifact", id: string) {
    if (await addLink(taskId, kind, id)) {
      setQuery("");
      onLinked();
    }
  }
  const groups: { label: string; kind: "task" | "asset" | "artifact"; items: { id: string; label: string }[] }[] = data
    ? [
        { label: "Registry", kind: "artifact", items: data.artifacts.map((a) => ({ id: a.id, label: `${a.artifactId} · ${a.title}` })) },
        { label: "Assets", kind: "asset", items: data.assets.map((a) => ({ id: a.id, label: `${a.sku} · ${a.itemName}` })) },
        { label: "Tasks", kind: "task", items: data.tasks.map((t) => ({ id: t.id, label: t.title })) },
      ]
    : [];
  return (
    <div className="relative">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Link an insight, SKU or task: type to search" className="h-8 text-xs" />
      {groups.some((g) => g.items.length > 0) && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {groups
            .filter((g) => g.items.length > 0)
            .map((group) => (
              <div key={group.kind}>
                <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                {group.items.map((item) => (
                  <button key={item.id} type="button" onClick={() => pick(group.kind, item.id)} className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted">
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * One task, opened: everything about it and every way to change it. Changes save as they're made.
 */
export function TaskSheet({
  taskId,
  board,
  onClose,
  onChanged,
}: {
  taskId: string;
  board: BoardView;
  onClose: () => void;
  /** Called after any change, to refresh the board. */
  onChanged: () => void;
}) {
  const { data, mutate } = useSWR<TaskDetailView>(taskDetailUrl(taskId), jsonFetcher);
  const [newSubtask, setNewSubtask] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  // Giving a task with no due date to someone else asks for the date first: they're notified the
  // moment the owner changes, and the notice should carry the date.
  const [pendingOwnerId, setPendingOwnerId] = useState<string | null>(null);
  const [pendingDueOn, setPendingDueOn] = useState("");
  const members: TeamMember[] = board.members;
  const names = new Map(members.map((m) => [m.id, m.name]));

  async function after(ok: boolean) {
    if (!ok) return;
    await mutate();
    onChanged();
  }

  if (!data) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:max-w-xl p-6">
          <SheetTitle className="sr-only">Loading task</SheetTitle>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </SheetContent>
      </Sheet>
    );
  }

  const { task } = data;
  const ownerPlan = board.plans.filter((p) => p.personnelId === task.ownerId).map((p) => p.taskId);
  const inOwnersToday = ownerPlan.includes(task.id);
  const patch = (fields: Record<string, unknown>) => updateTask(task.id, fields).then(after);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-6 space-y-5">
        <SheetHeader className="space-y-2 border-b pb-4">
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <Input
            key={`title-${task.title}`}
            defaultValue={task.title}
            onBlur={(e) => e.target.value.trim() && e.target.value !== task.title && patch({ title: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-auto border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
            aria-label="Task title"
          />
          <SheetDescription>
            Made {formatDate(task.createdAt)}
            {task.createdByName ? ` by ${task.createdByName}` : ""}
            {task.focus ? ` · focus: ${task.focus}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select value={task.status} onValueChange={(status) => patch({ status })}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEAM_TASK_STATUSES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kind of task">
            <Select value={task.area} onValueChange={(area) => patch({ area })}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEAM_TASK_AREAS.map((a) => (
                  <SelectItem key={a.key} value={a.key}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Owner">
            <Select
              value={task.ownerId}
              onValueChange={(ownerId) => {
                if (!task.dueOn && ownerId !== board.viewerId) setPendingOwnerId(ownerId);
                else patch({ ownerId });
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder={task.ownerName} />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Due">
            <Input
              type="date"
              key={`due-${task.dueOn}`}
              defaultValue={task.dueOn ?? ""}
              onChange={(e) => patch({ dueOn: e.target.value || null })}
              className="h-8 text-sm"
            />
          </Field>
        </div>

        {pendingOwnerId && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>
              {names.get(pendingOwnerId) ?? "They"} get an email and a Discord ping as soon as you give them this. Set a due date first?
            </p>
            <Input type="date" value={pendingDueOn} onChange={(e) => setPendingDueOn(e.target.value)} className="h-8 w-[180px]" aria-label="Due date" />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!pendingDueOn}
                onClick={() => {
                  patch({ ownerId: pendingOwnerId, dueOn: pendingDueOn });
                  setPendingOwnerId(null);
                }}
              >
                Give it with this due date
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  patch({ ownerId: pendingOwnerId });
                  setPendingOwnerId(null);
                }}
              >
                Give it without a due date
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingOwnerId(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {task.status !== DONE_STATUS && (
          <Button
            variant={inOwnersToday ? "secondary" : "outline"}
            size="sm"
            onClick={() => setTodayPlan(task.ownerId, inOwnersToday ? ownerPlan.filter((id) => id !== task.id) : [...ownerPlan, task.id]).then(after)}
          >
            {inOwnersToday ? <Sun className="h-3.5 w-3.5 text-amber-400" /> : <SunDim className="h-3.5 w-3.5" />}
            {inOwnersToday ? `In ${names.get(task.ownerId) ?? "the owner"}'s plan today` : `Add to ${names.get(task.ownerId) ?? "the owner"}'s plan today`}
          </Button>
        )}

        <Field label="Helpers">
          <div className="flex flex-wrap gap-1.5">
            {members
              .filter((m) => m.id !== task.ownerId)
              .map((m) => {
                const helping = task.helperIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => patch({ helperIds: helping ? task.helperIds.filter((id) => id !== m.id) : [...task.helperIds, m.id] })}
                    className={cn("rounded-full border px-2.5 py-0.5 text-xs", helping ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                  >
                    {m.name}
                  </button>
                );
              })}
          </div>
        </Field>

        <Field label={task.targetCount !== null ? "Count" : "Count (optional)"}>
          {task.targetCount !== null ? (
            <div className="flex items-center gap-2">
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => patch({ doneCount: Math.max(0, task.doneCount - 1) })} aria-label="One fewer">
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Input
                type="number"
                min={0}
                key={`count-${task.doneCount}`}
                defaultValue={task.doneCount}
                onBlur={(e) => Number(e.target.value) !== task.doneCount && patch({ doneCount: Number(e.target.value) })}
                className="h-8 w-20 text-center"
                aria-label="How many are done"
              />
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => patch({ doneCount: task.doneCount + 1 })} aria-label="One more">
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <span className="text-sm text-muted-foreground">of {task.targetCount}</span>
              <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => patch({ targetCount: null })}>
                Remove count
              </Button>
            </div>
          ) : (
            <Input
              type="number"
              min={1}
              placeholder="How many, e.g. 5 assets"
              onBlur={(e) => Number(e.target.value) > 0 && patch({ targetCount: Number(e.target.value) })}
              className="h-8 w-56 text-sm"
            />
          )}
        </Field>

        {task.status === BLOCKED_STATUS && (
          <Field label="Waiting on">
            <Input
              key={`waiting-${task.waitingOn}`}
              defaultValue={task.waitingOn ?? ""}
              placeholder="Who or what it's waiting on"
              onBlur={(e) => e.target.value !== (task.waitingOn ?? "") && patch({ waitingOn: e.target.value || null })}
              className="h-8 text-sm"
            />
          </Field>
        )}

        <Field label="Notes">
          <Textarea
            key={`notes-${task.notes}`}
            defaultValue={task.notes ?? ""}
            rows={3}
            placeholder="What it is, what done looks like"
            onBlur={(e) => e.target.value !== (task.notes ?? "") && patch({ notes: e.target.value || null })}
          />
        </Field>

        <Field label={`Subtasks (${task.subtasks.filter((s) => s.doneAt).length}/${task.subtasks.length})`}>
          <ul className="space-y-1.5">
            {task.subtasks.map((subtask) => (
              <li key={subtask.id} className="space-y-1.5 rounded-md border p-2">
                {/* The title gets the whole first line and wraps, so a long subtask is readable. */}
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(subtask.doneAt)}
                    onChange={() => updateSubtask(subtask.id, { done: !subtask.doneAt }).then(after)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                    aria-label={`Tick ${subtask.title}`}
                  />
                  <span className={cn("min-w-0 flex-1 break-words text-sm leading-snug", subtask.doneAt && "text-muted-foreground line-through")}>{subtask.title}</span>
                </label>
                <div className="flex flex-wrap items-center gap-2 pl-5">
                  <Select value={subtask.ownerId ?? NOBODY} onValueChange={(v) => updateSubtask(subtask.id, { ownerId: v === NOBODY ? null : v }).then(after)}>
                    <SelectTrigger className="h-7 w-[150px] text-xs" aria-label={`Who does ${subtask.title}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOBODY}>Task owner</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="date"
                    key={`subdue-${subtask.id}-${subtask.dueOn}`}
                    defaultValue={subtask.dueOn ?? ""}
                    onChange={(e) => updateSubtask(subtask.id, { dueOn: e.target.value || null }).then(after)}
                    className="h-7 w-[140px] text-xs"
                    aria-label={`When ${subtask.title} is due`}
                  />
                  <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" onClick={() => deleteSubtask(subtask.id).then(after)} aria-label={`Remove ${subtask.title}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="mt-1.5 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newSubtask.trim()) return;
              addSubtask(task.id, { title: newSubtask }).then((ok) => {
                if (ok) setNewSubtask("");
                return after(ok);
              });
            }}
          >
            <Input value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} placeholder="Add a subtask" className="h-8 text-sm" />
            <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!newSubtask.trim()}>
              Add
            </Button>
          </form>
        </Field>

        <Field label="Linked to">
          <ul className="space-y-1">
            {data.links.map((link) => {
              const Icon = LINK_ICONS[link.kind];
              return (
                <li key={link.id} className="flex items-center gap-2 text-sm">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Link href={link.href} className="min-w-0 flex-1 truncate hover:underline">
                    {link.label}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{link.sublabel.replace(/_/g, " ")}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeLink(link.id).then(after)} aria-label={`Unlink ${link.label}`}>
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
          <LinkPicker taskId={task.id} onLinked={() => after(true)} />
        </Field>

        <Field label="Updates">
          <ul className="space-y-2">
            {data.comments.map((comment) => (
              <li key={comment.id} className="rounded-md bg-muted/40 p-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  {comment.authorName ?? "Someone"} · {formatDateTime(comment.createdAt)}
                </p>
                <p className="whitespace-pre-wrap">{comment.body}</p>
              </li>
            ))}
          </ul>
          <MentionInput members={members} onPost={(body, mentionedIds) => addComment(task.id, body, mentionedIds).then(async (ok) => { await after(ok); return ok; })} />
        </Field>

        <div className="border-t pt-3">
          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Hide history" : `Show history (${data.history.length})`}
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1 text-xs">
              {data.history.map((entry) => (
                <li key={entry.id}>
                  <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span> {entry.actorName ?? "Pipeline"} {describeHistory(entry, names)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
