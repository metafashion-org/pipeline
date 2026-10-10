"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { planDayName } from "./team-types";

const EOD_URL = "/api/team/eod";

interface EodFields {
  done: string;
  slipped: string;
  blockers: string;
  needFromManager: string;
  nextOutcome: string;
}

interface EodResponse {
  today: string;
  dueTime: string;
  summaryTime: string;
  report: (EodFields & { submittedAt: string; updatedAt: string }) | null;
  nextDay: string;
  todayPlan: { title: string; done: boolean }[];
  nextPlan: { title: string; done: boolean }[];
}

const EMPTY: EodFields = { done: "", slipped: "", blockers: "", needFromManager: "", nextOutcome: "" };

// The boxes, in the order of the EOD email format, each with a nudge rather than an answer.
const BOXES: { key: Exclude<keyof EodFields, "nextOutcome">; label: string; placeholder: string }[] = [
  { key: "done", label: "Done", placeholder: "What you finished today, and what it moved forward." },
  { key: "slipped", label: "Slipped", placeholder: "What you planned but didn't finish, and why." },
  { key: "blockers", label: "Blockers", placeholder: "What's stopping you, and your proposed fix." },
  { key: "needFromManager", label: "Need from Arjun", placeholder: "A decision, an answer, an introduction..." },
];

/**
 * The viewer's end-of-day report, written in their own words. Beside the boxes, for reference only,
 * are their plan for today and their plan for the next work day, which they set on the board. It
 * goes to the whole team in the evening summary, and can be edited until then.
 */
export function EodDialog({ sent, dueTime, onSaved }: { sent: boolean; dueTime: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const { data, mutate } = useSWR<EodResponse>(open ? EOD_URL : null, jsonFetcher);
  // Null until the person types, so the boxes start from what they saved before.
  const [draft, setDraft] = useState<EodFields | null>(null);
  const [saving, setSaving] = useState(false);
  const fields = draft ?? (data?.report ? { ...EMPTY, ...data.report } : EMPTY);

  function edit(key: keyof EodFields, value: string) {
    setDraft({ ...fields, [key]: value });
  }

  async function save() {
    setSaving(true);
    try {
      const { ok, data: res } = await apiCall(EOD_URL, { method: "PUT", body: fields });
      if (!ok) {
        toast.error(res.error || "Couldn't save your EOD");
        return;
      }
      toast.success(data?.report ? "EOD updated" : "EOD sent");
      setDraft(null);
      await Promise.all([mutate(), onSaved()]);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const nextName = data ? planDayName(data.nextDay, data.today) : "tomorrow";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDraft(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={sent ? "outline" : "default"} className="h-8" title={sent ? "Your EOD is in. Open it to edit." : `Your EOD is due at ${dueTime}`}>
          {sent ? <Check className="h-4 w-4 text-emerald-400" /> : <ClipboardList className="h-4 w-4" />}
          {sent ? "EOD sent" : "Write EOD"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Your EOD</DialogTitle>
          <DialogDescription>
            {data?.report
              ? `Sent ${formatDateTime(data.report.submittedAt)}. You can edit it until the summary goes out at ${data.summaryTime}.`
              : `Due at ${data?.dueTime ?? dueTime}. It goes to the whole team in the evening summary${data ? ` at ${data.summaryTime}` : ""}.`}
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <div className="space-y-3">
              {BOXES.map((box) => (
                <div key={box.key} className="space-y-1">
                  <Label htmlFor={`eod-${box.key}`}>{box.label}</Label>
                  <Textarea id={`eod-${box.key}`} rows={3} value={fields[box.key]} placeholder={box.placeholder} onChange={(e) => edit(box.key, e.target.value)} />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor="eod-next">Plan for {nextName}: the outcome it&apos;s tied to</Label>
                {data.nextPlan.length === 0 && (
                  <p className="text-xs text-amber-400">
                    Nothing planned for {nextName} yet. Close this, pick {nextName} under &quot;Planning for&quot; and add your tasks.
                  </p>
                )}
                <Textarea
                  id="eod-next"
                  rows={2}
                  value={fields.nextOutcome}
                  placeholder="What finishing your plan gets us, e.g. the Christmas drop listed by Friday."
                  onChange={(e) => edit("nextOutcome", e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>
                  {data.report ? "Update EOD" : "Send EOD"}
                </Button>
              </div>
            </div>

            <aside className="space-y-3 rounded-md border bg-muted/30 p-3 text-xs">
              <p className="text-muted-foreground">From the board, for reference</p>
              <PlanList title="Today's plan" items={data.todayPlan} empty="You didn't plan today on the board." />
              <PlanList title={`Plan for ${nextName}`} items={data.nextPlan} empty="Nothing yet." />
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlanList({ title, items, empty }: { title: string; items: { title: string; done: boolean }[]; empty: string }) {
  return (
    <div className="space-y-1">
      <p className="font-medium">{title}</p>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <ol className="space-y-0.5">
          {items.map((item, index) => (
            <li key={`${index}-${item.title}`} className={cn("flex gap-1", item.done && "text-muted-foreground line-through")}>
              <span className="w-4 shrink-0 text-right">{index + 1}.</span>
              <span className="min-w-0 flex-1">{item.title}</span>
              {item.done && <Check className="h-3 w-3 shrink-0 text-emerald-400" />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
