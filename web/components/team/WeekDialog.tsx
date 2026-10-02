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
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Thu 1 Oct" for a "YYYY-MM-DD" day that is the index-th day of the week.
function dayLabel(day: string, index: number): string {
  const [, month, date] = day.split("-").map(Number);
  return `${WEEKDAY_LABELS[index]} ${date} ${MONTH_LABELS[month - 1]}`;
}

type WeekPersonDay = WeekView["people"][number]["days"][number];

// One person's day: their plan in order (with any count beside it), then anything else they finished.
function DayCell({ day, onOpenTask }: { day: WeekPersonDay; onOpenTask: (taskId: string) => void }) {
  const countFor = new Map(day.counted.map((c) => [c.taskId, c]));
  const plannedIds = new Set(day.planned.map((p) => p.taskId));
  const countedOutsidePlan = day.counted.filter((c) => !plannedIds.has(c.taskId));
  const doneOutsidePlan = day.done.filter((d) => !plannedIds.has(d.taskId));
  if (day.planned.length === 0 && countedOutsidePlan.length === 0 && doneOutsidePlan.length === 0) {
    return <span className="text-muted-foreground/50">-</span>;
  }
  return (
    <ul className="space-y-1">
      {day.planned.map((p, i) => {
        const count = countFor.get(p.taskId);
        // Counted work shows its count instead of a tick: a day closed at 0/5 isn't done.
        const done = p.status === DONE_STATUS && !count;
        return (
          <li key={p.taskId}>
            <button type="button" onClick={() => onOpenTask(p.taskId)} className={cn("text-left leading-snug hover:underline", done && "text-muted-foreground")}>
              <span className="mr-1 font-semibold text-primary">{i + 1}.</span>
              {p.title}
              {count && (
                <span className="ml-1 text-violet-300">
                  {count.doneCount}/{count.targetCount}
                  {count.focus ? ` · ${count.focus}` : ""}
                </span>
              )}

              {done && <Check className="ml-1 inline h-3 w-3 text-emerald-400" />}
            </button>
          </li>
        );
      })}
      {countedOutsidePlan.map((c) => (
        <li key={c.taskId}>
          <button type="button" onClick={() => onOpenTask(c.taskId)} className="text-left leading-snug hover:underline">
            {c.title} <span className="text-violet-300">{c.doneCount}/{c.targetCount}</span>
          </button>
        </li>
      ))}
      {doneOutsidePlan.map((d) => (
        <li key={d.taskId}>
          <button type="button" onClick={() => onOpenTask(d.taskId)} className="text-left leading-snug text-emerald-400 hover:underline">
            <Check className="mr-1 inline h-3 w-3" />
            {d.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A week of the team's work as a table: a row per day, a column per person. Each cell is that
 * person's plan for the day in order (ticked when finished, with any count beside it) and anything
 * else they finished that day.
 */
export function WeekDialog({ today, onOpenTask }: { today: string; onOpenTask: (taskId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const { data } = useSWR<WeekView>(open ? `/api/team/week?start=${weekStart}` : null, jsonFetcher);
  const people = data?.people ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <CalendarRange className="h-4 w-4" /> Week
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekStart(addDays(weekStart, -DAYS_PER_WEEK))} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            Week of {formatDate(weekStart)}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setWeekStart(addDays(weekStart, DAYS_PER_WEEK))} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </DialogTitle>
          <DialogDescription>Each person&apos;s plan for every day, in order, and what they finished. A tick means done.</DialogDescription>
        </DialogHeader>

        {!data && <p className="text-sm text-muted-foreground">Loading...</p>}
        {data && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[560px] table-fixed border-collapse text-xs">
              <thead>
                <tr className="bg-muted/40">
                  <th className="w-24 px-2 py-2 text-left font-medium text-muted-foreground">Day</th>
                  {people.map((person) => (
                    <th key={person.member.id} className="px-2 py-2 text-left font-medium">
                      {person.member.name}
                      <span className="block font-normal text-muted-foreground">{person.doneTotal} finished</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.days.map((day, index) => (
                  <tr key={day} className={cn("border-t align-top", day === today && "bg-primary/5")}>
                    <td className={cn("px-2 py-2 font-medium whitespace-nowrap", day === today ? "text-primary" : "text-muted-foreground")}>
                      {dayLabel(day, index)}
                      {day === today && <span className="block font-normal">Today</span>}
                    </td>
                    {people.map((person) => (
                      <td key={person.member.id} className="px-2 py-2">
                        <DayCell day={person.days[index]} onOpenTask={onOpenTask} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
