"use client";

import { useState } from "react";
import useSWR from "swr";
import { Repeat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { areaLabel, TEAM_TASK_AREAS } from "@/lib/team-tasks/task-rules";
import type { TeamMember } from "@/lib/team-tasks/team-members";

const RECURRING_URL = "/api/team/recurring";
// Monday first, as the team's week runs. The numbers are Date.getDay()'s: 0 = Sunday.
const WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];
const MONDAY_TO_SATURDAY = [1, 2, 3, 4, 5, 6];

interface RecurrenceRow {
  recurrence: {
    id: string;
    title: string;
    notes: string | null;
    area: string;
    ownerId: string;
    weekdays: number[];
    targetCount: number | null;
    focus: string | null;
    focusUntil: string | null;
    startsOn: string;
    endsOn: string | null;
    isActive: boolean;
  };
  ownerName: string;
}

interface RuleForm {
  title: string;
  area: string;
  ownerId: string;
  weekdays: number[];
  targetCount: string;
  focus: string;
  focusUntil: string;
  startsOn: string;
  endsOn: string;
  notes: string;
  isActive: boolean;
}

function emptyForm(ownerId: string, today: string): RuleForm {
  return { title: "", area: "", ownerId, weekdays: MONDAY_TO_SATURDAY, targetCount: "", focus: "", focusUntil: "", startsOn: today, endsOn: "", notes: "", isActive: true };
}

function daysLabel(weekdays: number[]): string {
  return WEEKDAYS.filter((w) => weekdays.includes(w.day)).map((w) => w.label).join(", ");
}

/**
 * Repeating tasks: a task that is made every chosen weekday and put in the owner's plan, such as
 * "Curate assets", 45 a day, focus Christmas until 31 December. Each day's task keeps its own
 * count, so the week view shows how each day went.
 */
export function RecurringDialog({ members, today, onChanged }: { members: TeamMember[]; today: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm | null>(null);
  const [saving, setSaving] = useState(false);
  const { data, mutate } = useSWR<{ recurrences: RecurrenceRow[] }>(open ? RECURRING_URL : null, jsonFetcher);

  function edit(row: RecurrenceRow | null) {
    if (!row) {
      setEditingId(null);
      setForm(emptyForm(members[0]?.id ?? "", today));
      return;
    }
    const r = row.recurrence;
    setEditingId(r.id);
    setForm({
      title: r.title,
      area: r.area,
      ownerId: r.ownerId,
      weekdays: r.weekdays,
      targetCount: r.targetCount ? String(r.targetCount) : "",
      focus: r.focus ?? "",
      focusUntil: r.focusUntil ?? "",
      startsOn: r.startsOn,
      endsOn: r.endsOn ?? "",
      notes: r.notes ?? "",
      isActive: r.isActive,
    });
  }

  async function save() {
    if (!form) return;
    if (!form.title.trim() || !form.area || !form.ownerId || form.weekdays.length === 0) {
      toast.error("Fill in the title, owner, kind and days");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: form.title,
        area: form.area,
        ownerId: form.ownerId,
        weekdays: form.weekdays,
        targetCount: form.targetCount ? Number(form.targetCount) : null,
        focus: form.focus || null,
        focusUntil: form.focusUntil || null,
        startsOn: form.startsOn,
        endsOn: form.endsOn || null,
        notes: form.notes || null,
        isActive: form.isActive,
      };
      const { ok, data: result } = await apiCall(editingId ? `${RECURRING_URL}/${editingId}` : RECURRING_URL, { method: editingId ? "PUT" : "POST", body });
      if (!ok) {
        toast.error(result.error || "Couldn't save the repeating task");
        return;
      }
      toast.success(editingId ? "Repeating task saved" : "Repeating task added. Today's task appears on the board if today is one of its days.");
      setForm(null);
      await mutate();
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setForm(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Repeat className="h-4 w-4" /> Repeating
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Repeating tasks</DialogTitle>
          <DialogDescription>
            Made on the days you pick and put in the owner&apos;s plan. Add a count for daily targets, and a focus for the season, e.g. 45 a day, Christmas until 31 Dec.
          </DialogDescription>
        </DialogHeader>

        {!form && (
          <div className="space-y-2">
            {(data?.recurrences ?? []).length === 0 && <p className="text-sm text-muted-foreground">No repeating tasks yet.</p>}
            {data?.recurrences.map((row) => (
              <button
                key={row.recurrence.id}
                type="button"
                onClick={() => edit(row)}
                className={cn("block w-full rounded-md border p-3 text-left hover:border-primary/50", !row.recurrence.isActive && "opacity-60")}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{row.recurrence.title}</span>
                  <span className="text-xs text-muted-foreground">{row.recurrence.isActive ? daysLabel(row.recurrence.weekdays) : "Off"}</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {row.ownerName} · {areaLabel(row.recurrence.area)}
                  {row.recurrence.targetCount ? ` · ${row.recurrence.targetCount} a day` : ""}
                  {row.recurrence.focus ? ` · focus ${row.recurrence.focus}${row.recurrence.focusUntil ? ` until ${formatDate(row.recurrence.focusUntil)}` : ""}` : ""}
                </span>
              </button>
            ))}
            <Button size="sm" onClick={() => edit(null)} disabled={members.length === 0}>
              Add a repeating task
            </Button>
          </div>
        )}

        {form && (
          <div className="space-y-3">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Curate assets" aria-label="Title" />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Owner</p>
                <Select value={form.ownerId} onValueChange={(ownerId) => setForm({ ...form, ownerId })}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
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
                <p className="text-xs text-muted-foreground">Kind of task</p>
                <Select value={form.area} onValueChange={(area) => setForm({ ...form, area })}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Pick one" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_TASK_AREAS.map((a) => (
                      <SelectItem key={a.key} value={a.key}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Repeats on</p>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => {
                  const on = form.weekdays.includes(w.day);
                  return (
                    <button
                      key={w.day}
                      type="button"
                      onClick={() => setForm({ ...form, weekdays: on ? form.weekdays.filter((d) => d !== w.day) : [...form.weekdays, w.day] })}
                      className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                    >
                      {w.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Count a day (optional)</p>
                <Input type="number" min={1} value={form.targetCount} onChange={(e) => setForm({ ...form, targetCount: e.target.value })} placeholder="e.g. 45" className="h-9" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Focus (optional)</p>
                <Input value={form.focus} onChange={(e) => setForm({ ...form, focus: e.target.value })} placeholder="e.g. Christmas" className="h-9" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Focus until</p>
                <Input type="date" value={form.focusUntil} onChange={(e) => setForm({ ...form, focusUntil: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Starts</p>
                <Input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Ends (optional)</p>
                <Input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} className="h-9" />
              </div>
            </div>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Notes for each day's task (optional)" aria-label="Notes" />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.isActive} onCheckedChange={(isActive) => setForm({ ...form, isActive })} />
              {form.isActive ? "On" : "Off: no new tasks are made"}
            </label>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setForm(null)} disabled={saving}>
                Back
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
