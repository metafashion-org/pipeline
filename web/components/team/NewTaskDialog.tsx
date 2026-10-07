"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TEAM_TASK_AREAS } from "@/lib/team-tasks/task-rules";
import type { TeamMember } from "@/lib/team-tasks/team-members";
import { createTask } from "./team-actions";

/**
 * Makes a task: what it is, who owns it, and what kind of work it is. The owner defaults to the
 * person making it; giving it to someone else tells them.
 */
export function NewTaskDialog({
  members,
  viewerId,
  onCreated,
}: {
  members: TeamMember[];
  viewerId: string | null;
  onCreated: (taskId: string) => void;
}) {
  const defaultOwner = members.some((m) => m.id === viewerId) ? (viewerId as string) : (members[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(defaultOwner);
  const [area, setArea] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [notes, setNotes] = useState("");
  const [addToToday, setAddToToday] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  // Shown once when the task goes to someone else without a due date: they're notified the moment
  // it's added, so the date has to be in it before then.
  const [askForDueDate, setAskForDueDate] = useState(false);
  const [saving, setSaving] = useState(false);

  function handleOpenChange(next: boolean) {
    // Cleared on the way in, so the closing animation doesn't flash an empty form.
    if (next) {
      setTitle("");
      setOwnerId(defaultOwner);
      setArea("");
      setDueOn("");
      setNotes("");
      setAddToToday(false);
      setIsPrivate(false);
      setAskForDueDate(false);
    }
    setOpen(next);
  }

  async function submit(withoutDueDate = false) {
    if (!title.trim()) return toast.error("Give the task a title");
    if (!area) return toast.error("Pick what kind of task it is");
    if (!ownerId) return toast.error("Pick who owns it");
    if (ownerId !== viewerId && !dueOn && !withoutDueDate) {
      setAskForDueDate(true);
      return;
    }
    setSaving(true);
    try {
      const id = await createTask({ title, area, ownerId, dueOn: dueOn || null, notes: notes || null, addToToday, isPrivate });
      if (!id) return;
      toast.success(ownerId === viewerId ? "Task added" : `Task given to ${members.find((m) => m.id === ownerId)?.name ?? "them"}`);
      setOpen(false);
      onCreated(id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={members.length === 0}>
          <Plus className="h-4 w-4" /> New task
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>One owner. Subtasks, links and updates go on the task once it&apos;s made.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing" aria-label="Title" autoFocus />
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Kind of task</p>
            <div className="flex flex-wrap gap-1.5">
              {TEAM_TASK_AREAS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setArea(a.key)}
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs", area === a.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Owner</p>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Who owns it" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Due (optional)</p>
              <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-9" />
            </div>
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Notes (optional)" aria-label="Notes" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={addToToday} onChange={(e) => setAddToToday(e.target.checked)} className="h-4 w-4 accent-primary" />
            Add to the owner&apos;s plan for today
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="h-4 w-4 accent-primary" />
            Private: only you, the owner and any helpers see it
          </label>
        </div>
        {askForDueDate && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>
              {members.find((m) => m.id === ownerId)?.name ?? "They"} get an email and a Discord ping as soon as you add this. Set a due date first?
            </p>
            <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-9 w-[180px]" aria-label="Due date" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => submit()} disabled={saving || !dueOn}>
                Add with this due date
              </Button>
              <Button size="sm" variant="ghost" onClick={() => submit(true)} disabled={saving}>
                Add without a due date
              </Button>
            </div>
          </div>
        )}
        {!askForDueDate && (
          <DialogFooter>
            <Button onClick={() => submit()} disabled={saving}>
              {saving ? "Adding..." : "Add task"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
