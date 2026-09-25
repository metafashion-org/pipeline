"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { jsonFetcher } from "@/lib/fetcher";

type EventType = "deadline" | "planned_upload" | "went_live";

interface CalendarEvent {
  type: EventType;
  date: string;
  sku: string;
  itemName: string;
  status: string;
  artistName: string | null;
  brandGroupName: string | null;
  done: boolean;
}

// How each kind of date looks, and what it's called in the legend and filters.
const EVENT_STYLES: Record<EventType, { label: string; dot: string; chip: string }> = {
  deadline: {
    label: "Artist deadline",
    dot: "bg-amber-500",
    chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  },
  planned_upload: {
    label: "Planned upload",
    dot: "bg-blue-500",
    chip: "bg-blue-500/15 text-blue-800 dark:text-blue-300",
  },
  went_live: {
    label: "Went live",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  },
};

const EVENT_TYPES: EventType[] = ["deadline", "planned_upload", "went_live"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Every day is placed on its India date, where the team works, whatever the viewer's own timezone.
const istDayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const monthTitle = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

// Plain calendar-date arithmetic on YYYY-MM-DD strings, done in UTC so no timezone shifts a day.
function addDays(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayKey(): string {
  return istDayKey.format(new Date());
}

/** The days the month grid shows: Monday on or before the 1st, through the Sunday on or after the last day. */
function gridDays(monthKey: string): string[] {
  const first = `${monthKey}-01`;
  const mondayOffset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  const nextMonthFirst = new Date(`${first}T00:00:00Z`);
  nextMonthFirst.setUTCMonth(nextMonthFirst.getUTCMonth() + 1);
  const lastDay = addDays(nextMonthFirst.toISOString().slice(0, 10), -1);
  const sundayOffset = (7 - new Date(`${lastDay}T00:00:00Z`).getUTCDay()) % 7;
  const end = addDays(lastDay, sundayOffset);

  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

function shiftMonth(monthKey: string, months: number): string {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
}

function EventChip({ event }: { event: CalendarEvent }) {
  const style = EVENT_STYLES[event.type];
  return (
    <Link
      href={`/admin/board?asset=${encodeURIComponent(event.sku)}`}
      title={`${style.label}: ${event.itemName} (${event.sku})${event.artistName ? `, ${event.artistName}` : ""}${
        event.brandGroupName ? `, ${event.brandGroupName}` : ""
      }`}
      className={`block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight hover:opacity-80 ${style.chip} ${
        event.done ? "opacity-50 line-through" : ""
      }`}
    >
      {event.itemName}
    </Link>
  );
}

/**
 * The company-wide asset calendar: every artist deadline, planned upload and go-live date, laid out
 * by month so everyone sees what ships when. Each entry opens the asset on the board. Done items
 * (a deadline the artist has delivered on, a planned upload that went live) are struck through.
 */
export function AssetCalendar() {
  const [monthKey, setMonthKey] = useState(() => todayKey().slice(0, 7));
  const [visible, setVisible] = useState<Record<EventType, boolean>>({
    deadline: true,
    planned_upload: true,
    went_live: true,
  });

  const days = useMemo(() => gridDays(monthKey), [monthKey]);
  const rangeKey = `/api/calendar?from=${days[0]}&to=${addDays(days[days.length - 1], 1)}`;
  const { data, isLoading } = useSWR<{ events: CalendarEvent[] }>(rangeKey, jsonFetcher);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of data?.events ?? []) {
      if (!visible[event.type]) continue;
      const key = istDayKey.format(new Date(event.date));
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [data, visible]);

  const today = todayKey();
  const monthEvents = days.filter((d) => d.startsWith(monthKey)).flatMap((d) => (eventsByDay.get(d) ?? []).map((e) => ({ day: d, event: e })));

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
        <div className="flex flex-wrap gap-2">
          {EVENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={visible[type]}
              onClick={() => setVisible((v) => ({ ...v, [type]: !v[type] }))}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                visible[type] ? "border-border" : "border-transparent opacity-40"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${EVENT_STYLES[type].dot}`} />
              {EVENT_STYLES[type].label}
            </button>
          ))}
        </div>
      </div>

      {/* Month grid, from tablet width up. */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 gap-px rounded-md border bg-border overflow-hidden">
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
              {w}
            </div>
          ))}
          {days.map((day) => {
            const inMonth = day.startsWith(monthKey);
            const events = eventsByDay.get(day) ?? [];
            return (
              <div key={day} className={`min-h-28 bg-background p-1.5 space-y-1 ${inMonth ? "" : "opacity-40"}`}>
                <div
                  className={`text-xs ${
                    day === today ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {Number(day.slice(8))}
                </div>
                {events.map((event) => (
                  <EventChip key={`${event.type}-${event.sku}`} event={event} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* A list on phones, where seven columns don't fit. */}
      <div className="md:hidden space-y-2">
        {monthEvents.length === 0 && !isLoading && <p className="text-sm text-muted-foreground">Nothing scheduled this month.</p>}
        {monthEvents.map(({ day, event }) => (
          <div key={`${day}-${event.type}-${event.sku}`} className="flex items-start gap-3">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">{Number(day.slice(8))} {monthTitle.format(new Date(`${day}T00:00:00Z`)).slice(0, 3)}</span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <EventChip event={event} />
              <p className="text-[11px] text-muted-foreground">{EVENT_STYLES[event.type].label}</p>
            </div>
          </div>
        ))}
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
    </div>
  );
}
