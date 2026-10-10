"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { jsonFetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { gridDays, monthTitle, shiftMonth, todayKey, WEEKDAYS } from "./AssetCalendar";

interface Entry {
  kind: "plan" | "due";
  day: string;
  taskId: string;
  title: string;
  personnelId: string;
  done: boolean;
}

const EVERYONE = "all";

function EntryChip({ entry, owner }: { entry: Entry; owner: string | undefined }) {
  const due = entry.kind === "due";
  return (
    <Link
      href={`/team?task=${entry.taskId}`}
      title={`${due ? "Due" : "Planned"}: ${entry.title}${owner ? `, ${owner}` : ""}`}
      // A plan is a filled chip (a day someone works on it); a deadline is an outlined one with a flag,
      // so the two never read alike.
      className={cn(
        "block line-clamp-2 break-words rounded-sm px-1.5 py-1 text-[13px] leading-snug hover:bg-accent",
        due ? "border border-dashed border-red-400/70 text-red-300" : "border-l-[3px] border-amber-400 bg-amber-400/10",
        entry.done && "text-muted-foreground line-through"
      )}
    >
      {due && <span aria-label="Due">⚑ </span>}
      {owner && <span className="font-medium">{owner.split(" ")[0]}: </span>}
      {entry.title}
    </Link>
  );
}

/**
 * The Team Tasks calendar: for each day, what each person planned to work on (filled chips) and
 * which tasks are due (outlined, flagged). Planning a day happens on Team Tasks; this is the view of
 * the week and month. Each chip opens the task.
 */
export function TaskCalendar() {
  const [monthKey, setMonthKey] = useState(() => todayKey().slice(0, 7));
  const [person, setPerson] = useState<string>(EVERYONE);
  const days = useMemo(() => gridDays(monthKey), [monthKey]);
  const { data, isLoading } = useSWR<{ entries: Entry[]; members: { id: string; name: string }[] }>(
    `/api/team/calendar?from=${days[0]}&to=${days[days.length - 1]}`,
    jsonFetcher
  );
  const names = new Map((data?.members ?? []).map((m) => [m.id, m.name]));
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of data?.entries ?? []) {
      if (person !== EVERYONE && entry.personnelId !== person) continue;
      map.set(entry.day, [...(map.get(entry.day) ?? []), entry]);
    }
    // Deadlines first in a day, then plans.
    for (const list of map.values()) list.sort((a, b) => Number(b.kind === "due") - Number(a.kind === "due"));
    return map;
  }, [data, person]);
  const today = todayKey();
  const monthDays = days.filter((d) => d.startsWith(monthKey) && (byDay.get(d) ?? []).length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" aria-label="Previous month" onClick={() => setMonthKey(shiftMonth(monthKey, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="min-w-40 text-center text-lg font-semibold">{monthTitle.format(new Date(`${monthKey}-01T00:00:00Z`))}</h2>
          <Button size="icon" variant="outline" aria-label="Next month" onClick={() => setMonthKey(shiftMonth(monthKey, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMonthKey(today.slice(0, 7))}>
            Today
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {[{ id: EVERYONE, name: "Everyone" }, ...(data?.members ?? [])].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setPerson(m.id)}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs", person === m.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {m.name}
            </button>
          ))}
          <span className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
            <span className="h-3 w-3 rounded-sm border-l-[3px] border-amber-400 bg-amber-400/10" /> planned
            <span className="ml-2 h-3 w-3 rounded-sm border border-dashed border-red-400/70" /> due
          </span>
        </div>
      </div>

      <div className="hidden md:block">
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-muted px-2 py-1.5 text-sm font-medium text-muted-foreground">
              {w}
            </div>
          ))}
          {days.map((day) => {
            const inMonth = day.startsWith(monthKey);
            return (
              <div key={day} className={cn("min-h-32 space-y-1 p-1.5", inMonth ? "bg-background" : "bg-muted/60")}>
                <div
                  className={cn(
                    "text-sm font-medium",
                    day === today ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {Number(day.slice(8))}
                </div>
                {(byDay.get(day) ?? []).map((entry) => (
                  <EntryChip key={`${entry.kind}-${entry.taskId}-${entry.personnelId}`} entry={entry} owner={person === EVERYONE ? names.get(entry.personnelId) : undefined} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {monthDays.length === 0 && !isLoading && <p className="text-sm text-muted-foreground">Nothing planned or due this month.</p>}
        {monthDays.map((day) => (
          <div key={day} className="space-y-1">
            <p className="text-sm text-muted-foreground">{Number(day.slice(8))} {monthTitle.format(new Date(`${day}T00:00:00Z`)).slice(0, 3)}</p>
            {(byDay.get(day) ?? []).map((entry) => (
              <EntryChip key={`${entry.kind}-${entry.taskId}-${entry.personnelId}`} entry={entry} owner={person === EVERYONE ? names.get(entry.personnelId) : undefined} />
            ))}
          </div>
        ))}
      </div>
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
    </div>
  );
}
