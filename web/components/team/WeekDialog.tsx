"use client";

import { useState } from "react";
import useSWR from "swr";
import { CalendarRange, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { addDays, DONE_STATUS, weekStartOf } from "@/lib/team-tasks/task-rules";
import type { WeekView } from "./team-types";

const DAYS_PER_WEEK = 7;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A week of the team's work: for each person and day, their plan in order (ticked when finished),
 * anything else they finished, and counted work such as curated 38 of 45.
 */
export function WeekDialog({ today, onOpenTask }: { today: string; onOpenTask: (taskId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const { data } = useSWR<WeekView>(open ? `/api/team/week?start=${weekStart}` : null, jsonFetcher);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <CalendarRange className="h-4 w-4" /> Week
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekStart(addDays(weekStart, -DAYS_PER_WEEK))} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            Week of {formatDate(weekStart)}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekStart(addDays(weekStart, DAYS_PER_WEEK))} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </DialogTitle>
          <DialogDescription>What each person planned and finished, day by day. Plans are kept for every day, so any day can be looked back on.</DialogDescription>
        </DialogHeader>
        {!data && <p className="text-sm text-muted-foreground">Loading...</p>}
        {data?.people.map((person) => (
          <section key={person.member.id} className="space-y-2">
            <h3 className="text-sm font-semibold">
              {person.member.name} <span className="font-normal text-muted-foreground">· {person.doneTotal} finished this week</span>
            </h3>
            <div className="grid grid-cols-7 gap-1.5 overflow-x-auto">
              {person.days.map((day, index) => {
                const plannedIds = new Set(day.planned.map((p) => p.taskId));
                const extraDone = day.done.filter((d) => !plannedIds.has(d.taskId));
                return (
                  <div key={day.day} className={cn("min-w-[120px] rounded-md border p-1.5 text-xs", day.day === today && "border-primary")}>
                    <p className="mb-1 font-medium text-muted-foreground">
                      {WEEKDAY_LABELS[index]} {formatDate(day.day).split(" ").slice(0, 2).join(" ")}
                    </p>
                    {day.counted.map((c) => (
                      <p key={c.taskId} className="text-violet-300">
                        {c.title}: {c.doneCount}/{c.targetCount}
                        {c.focus ? ` · ${c.focus}` : ""}
                      </p>
                    ))}
                    <ol className="space-y-0.5">
                      {day.planned.map((p, i) => (
                        <li key={p.taskId}>
                          <button type="button" onClick={() => onOpenTask(p.taskId)} className={cn("text-left hover:underline", p.status === DONE_STATUS && "text-muted-foreground")}>
                            {i + 1}. {p.title} {p.status === DONE_STATUS && <Check className="inline h-3 w-3 text-emerald-400" />}
                          </button>
                        </li>
                      ))}
                    </ol>
                    {extraDone.map((d) => (
                      <button key={d.taskId} type="button" onClick={() => onOpenTask(d.taskId)} className="block text-left text-emerald-400 hover:underline">
                        Done: {d.title}
                      </button>
                    ))}
                    {day.planned.length === 0 && extraDone.length === 0 && day.counted.length === 0 && <p className="text-muted-foreground/60">-</p>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
