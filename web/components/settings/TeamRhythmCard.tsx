"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import type { TeamRhythm } from "@/lib/team-tasks/team-rhythm";

const RHYTHM_URL = "/api/admin/team-rhythm";
// Monday first, as the week is planned; the numbers are JavaScript's (0 = Sunday).
const WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];

/**
 * The Team Tasks routine, changeable while it's being tried out: how far ahead people plan, the work
 * days, when the EOD is due, when the evening summary goes out, and the reminder before it.
 */
export function TeamRhythmCard() {
  const { data, mutate } = useSWR<{ rhythm: TeamRhythm }>(RHYTHM_URL, jsonFetcher);
  // Null until edited, so the form starts from what's saved.
  const [draft, setDraft] = useState<TeamRhythm | null>(null);
  const [saving, setSaving] = useState(false);
  const rhythm = draft ?? data?.rhythm;
  if (!rhythm) return null;

  function edit(patch: Partial<TeamRhythm>) {
    setDraft({ ...(rhythm as TeamRhythm), ...patch });
  }

  async function save() {
    setSaving(true);
    try {
      const { ok, data: res } = await apiCall(RHYTHM_URL, { method: "PUT", body: rhythm });
      if (!ok) return toast.error(res.error || "Couldn't save");
      toast.success("Saved");
      setDraft(null);
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" /> Planning and EOD
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          People plan on Team Tasks for today and the next few work days, and write their EOD there. The evening summary emails everyone&apos;s
          EOD to the team, names who didn&apos;t send one and marks the late ones. Times are India time. The reminder and the summary are checked
          every 15 minutes, so they can land up to 15 minutes after the time set here.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          <Label>Work days</Label>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map(({ day, label }) => {
              const on = rhythm.workDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => edit({ workDays: on ? rhythm.workDays.filter((d) => d !== day) : [...rhythm.workDays, day] })}
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">The last work day of the week plans the first one of the next, e.g. Saturday plans Monday.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan ahead (work days after today)">
            <Input type="number" min={1} max={14} value={rhythm.planAheadDays} onChange={(e) => edit({ planAheadDays: Number(e.target.value) })} />
          </Field>
          <Field label="EOD due by">
            <Input type="time" value={rhythm.eodDueTime} onChange={(e) => edit({ eodDueTime: e.target.value })} />
          </Field>
          <Field label="Summary emailed to the team at">
            <Input type="time" value={rhythm.summaryTime} onChange={(e) => edit({ summaryTime: e.target.value })} />
          </Field>
          <Field label="Reminder to people without an EOD">
            <div className="flex items-center gap-2">
              <Switch checked={rhythm.reminderOn} onCheckedChange={(on) => edit({ reminderOn: on })} aria-label="Send the EOD reminder" />
              <Input type="time" value={rhythm.reminderTime} disabled={!rhythm.reminderOn} onChange={(e) => edit({ reminderTime: e.target.value })} />
            </div>
          </Field>
        </div>

        <Button size="sm" onClick={save} disabled={saving || !draft}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
