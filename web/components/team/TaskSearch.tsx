"use client";

import { useState } from "react";
import useSWR from "swr";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";
import { statusLabel, DONE_STATUS } from "@/lib/team-tasks/task-rules";
import type { SearchHitView } from "./team-types";

const SEARCH_MIN_CHARS = 2;

/**
 * Searches every task, finished ones included, by title, notes and updates. Finished tasks leave
 * the board at the end of their day; this is how they're found again.
 */
export function TaskSearch({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const trimmed = query.trim();
  const { data } = useSWR<{ results: SearchHitView[] }>(trimmed.length >= SEARCH_MIN_CHARS ? `/api/team/search?q=${encodeURIComponent(trimmed)}` : null, jsonFetcher);
  const results = data?.results ?? [];

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search all tasks, done too"
        className="h-8 w-[220px] pl-7 text-xs"
        aria-label="Search all tasks"
      />
      {open && trimmed.length >= SEARCH_MIN_CHARS && (
        <div className="absolute right-0 z-30 mt-1 max-h-80 w-[340px] overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {data && results.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">No tasks match.</p>}
          {results.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                onOpenTask(hit.id);
              }}
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted"
            >
              <span className="block truncate text-sm">{hit.title}</span>
              <span className="block text-xs text-muted-foreground">
                {hit.ownerName} · {statusLabel(hit.status)}
                {hit.status === DONE_STATUS && hit.completedAt ? ` ${formatDate(hit.completedAt)}` : ""}
                {hit.dueOn && hit.status !== DONE_STATUS ? ` · due ${formatDate(hit.dueOn)}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
