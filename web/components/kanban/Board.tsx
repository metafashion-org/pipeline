"use client";

import { useState, useEffect, useCallback } from "react";
import {
    DndContext,
    DragOverlay,
    useSensors,
    useSensor,
    MouseSensor,
    TouchSensor,
    DragStartEvent,
    DragEndEvent,
    closestCorners,
} from "@dnd-kit/core";
import useSWR from "swr";
import { Loader2, X, ChevronDown } from "lucide-react";

import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { toast } from "sonner";
// The client types, not the server ones: the two date fields are Dates when this came from the
// server render and ISO strings when SWR refetched it.
import type { KanbanColumnDataClient, KanbanAssetCardClient } from "@/lib/kanban/kanban-service";
import { jsonFetcher } from "@/lib/fetcher";
import { apiCall } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BoardProps {
    initialColumns?: KanbanColumnDataClient[];
    role: string;
}

interface MultiFilterOption {
    value: string;
    label: string;
    /** Options with this true are grouped and listed ahead of the rest — used to put active artists first. */
    prioritized?: boolean;
}

/** A "N selected" dropdown of checkboxes, used for both the artist and registry-link filters below. */
function MultiFilterDropdown({
    label,
    options,
    selected,
    onChange,
}: {
    label: string;
    options: MultiFilterOption[];
    selected: string[];
    onChange: (next: string[]) => void;
}) {
    const toggle = (value: string) => {
        onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
    };

    const prioritized = options.filter((o) => o.prioritized);
    const rest = options.filter((o) => !o.prioritized);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                    {selected.length === 0 ? label : `${label}: ${selected.length} selected`}
                    <ChevronDown className="h-3 w-3" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                {options.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Nothing to filter by yet.</div>
                )}
                {prioritized.length > 0 && (
                    <>
                        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Active</DropdownMenuLabel>
                        {prioritized.map((o) => (
                            <DropdownMenuCheckboxItem
                                key={o.value}
                                checked={selected.includes(o.value)}
                                onCheckedChange={() => toggle(o.value)}
                                onSelect={(e) => e.preventDefault()}
                            >
                                {o.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                        {rest.length > 0 && <DropdownMenuSeparator />}
                    </>
                )}
                {rest.map((o) => (
                    <DropdownMenuCheckboxItem
                        key={o.value}
                        checked={selected.includes(o.value)}
                        onCheckedChange={() => toggle(o.value)}
                        onSelect={(e) => e.preventDefault()}
                    >
                        {o.label}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function Board({ initialColumns = [], role }: BoardProps) {
    const { data: swrResponse, mutate, isValidating } = useSWR<{ data: KanbanColumnDataClient[] }>("/api/assets", jsonFetcher, {
        fallbackData: { data: initialColumns },
        // The server component already rendered this board from a fresh query, so revalidating on mount refetched the whole thing immediately and made every visit pay for the same data twice.
        // Focus revalidation and the polling interval still keep it current after that.
        revalidateOnMount: false,
        revalidateOnFocus: true,
        refreshInterval: 20000,
    });

    const allColumns: KanbanColumnDataClient[] = swrResponse?.data || initialColumns || [];
    const [activeTask, setActiveTask] = useState<KanbanAssetCardClient | null>(null);
    const [mounted, setMounted] = useState(false);

    // Filters — artist, deadline range, deadline month, and registry-artifact links. Purely
    // client-side: the data's already loaded, so filtering it again over the network would just
    // be added latency for no reason. "Deadline from/to" rather than a single date, since a range
    // covers both "what's due this week" and "what's due today" without needing two controls.
    // Month is a distinct control from that range — "what shipped in a given month" (e.g.
    // reviewing everything tagged for a season) is a different question than "what's due between
    // two arbitrary dates", so it isn't merged into the range inputs.
    const [artistFilter, setArtistFilter] = useState<string[]>([]);
    const [deadlineFrom, setDeadlineFrom] = useState<string>("");
    const [deadlineTo, setDeadlineTo] = useState<string>("");
    const [monthFilter, setMonthFilter] = useState<string>(""); // "YYYY-MM", from <input type="month">
    const [artifactFilter, setArtifactFilter] = useState<string[]>([]);

    const allAssetsFlat = allColumns.flatMap((c) => c.assets);

    // Active artists first, per the ask — everyone else follows, both groups alphabetical.
    const artistOptions = (() => {
        const byName = new Map<string, { active: boolean }>();
        for (const a of allAssetsFlat) {
            if (!a.artistName) continue;
            if (!byName.has(a.artistName)) byName.set(a.artistName, { active: a.artistStatus === "Active" });
        }
        return Array.from(byName.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, { active }]) => ({ value: name, label: name, prioritized: active }));
    })();

    // Every registry artifact currently linked to at least one asset on the board — an artifact
    // nothing is linked to yet would just be a dead option, so the list is derived from real
    // links rather than the full registry.
    const artifactOptions = (() => {
        const byId = new Map<string, string>();
        for (const a of allAssetsFlat) {
            for (const link of a.linkedArtifacts) {
                if (!byId.has(link.id)) byId.set(link.id, `${link.artifactId} — ${link.title}`);
            }
        }
        return Array.from(byId.entries())
            .sort(([, a], [, b]) => a.localeCompare(b))
            .map(([id, label]) => ({ value: id, label }));
    })();

    const hasActiveFilters =
        artistFilter.length > 0 || deadlineFrom !== "" || deadlineTo !== "" || monthFilter !== "" || artifactFilter.length > 0;

    const columns: KanbanColumnDataClient[] = hasActiveFilters
        ? allColumns.map((col) => ({
              ...col,
              assets: col.assets.filter((a) => {
                  if (artistFilter.length > 0 && (!a.artistName || !artistFilter.includes(a.artistName))) return false;
                  if (deadlineFrom || deadlineTo) {
                      if (!a.deadline) return false;
                      const d = new Date(a.deadline);
                      if (deadlineFrom && d < new Date(deadlineFrom)) return false;
                      if (deadlineTo && d > new Date(`${deadlineTo}T23:59:59`)) return false;
                  }
                  if (monthFilter) {
                      if (!a.deadline) return false;
                      const d = new Date(a.deadline);
                      const assetMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                      if (assetMonth !== monthFilter) return false;
                  }
                  if (artifactFilter.length > 0 && !a.linkedArtifacts.some((link) => artifactFilter.includes(link.id))) {
                      return false;
                  }
                  return true;
              }),
          }))
        : allColumns;

    // Marks the component as mounted so the board renders on the client only (see `if (!mounted) return null` below). No render-time value can tell server from client here, so this one setState in an effect is intended.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMounted(true);
    }, []);

    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 10,
            },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 250,
                tolerance: 5,
            },
        })
    );

    const findTask = (sku: string): KanbanAssetCardClient | null => {
        for (const col of columns) {
            const found = col.assets.find((a) => a.sku === sku || a.id === sku);
            if (found) return found;
        }
        return null;
    };

    const submitStatusUpdate = useCallback(async (
        sku: string,
        newStatus: string,
        previousColumns: KanbanColumnDataClient[]
    ) => {
        const { ok, data } = await apiCall(`/api/assets/${sku}/status`, {
            method: "PATCH",
            body: { status: newStatus },
        });

        if (!ok) {
            const message = data.error || "Failed to update status";
            console.error(message);
            toast.error(message);
            mutate({ data: previousColumns }, false);
            return;
        }
        toast.success("Task status updated successfully");
        mutate();
    }, [mutate]);

    const onDragStart = (event: DragStartEvent) => {
        const { active } = event;
        const task = findTask(active.id as string);
        if (task) setActiveTask(task);
    };

    const onDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveTask(null);

        if (!over) return;

        const activeId = active.id as string;
        const overId = over.id as string;

        const draggedTask = findTask(activeId);
        if (!draggedTask) return;

        let newStatus: string | undefined;

        if (columns.some((c) => c.key === overId)) {
            newStatus = overId;
        } else {
            const overTask = findTask(overId);
            if (overTask) {
                newStatus = overTask.currentStatus;
            }
        }

        if (!newStatus || newStatus === draggedTask.currentStatus) {
            return;
        }

        // Rollback snapshot must be the *unfiltered* data — the SWR cache always
        // holds the true full board, and filtering is display-only. Using the
        // filtered `columns` here would, on a failed update, overwrite the cache
        // with only the currently-visible subset and silently drop every other
        // artist's/date's cards until the next revalidation.
        const previousColumns = [...allColumns];
        await submitStatusUpdate(draggedTask.sku, newStatus, previousColumns);
    };

    if (!mounted) return null;

    return (
        <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <MultiFilterDropdown
                    label="All artists"
                    options={artistOptions}
                    selected={artistFilter}
                    onChange={setArtistFilter}
                />

                <Input
                    type="date"
                    value={deadlineFrom}
                    onChange={(e) => setDeadlineFrom(e.target.value)}
                    className="w-[140px] h-8 text-xs"
                    aria-label="Deadline from"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                    type="date"
                    value={deadlineTo}
                    onChange={(e) => setDeadlineTo(e.target.value)}
                    className="w-[140px] h-8 text-xs"
                    aria-label="Deadline to"
                />

                <span className="text-xs text-muted-foreground pl-1">month</span>
                <Input
                    type="month"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                    className="w-[140px] h-8 text-xs"
                    aria-label="Deadline month"
                />

                <MultiFilterDropdown
                    label="All registry links"
                    options={artifactOptions}
                    selected={artifactFilter}
                    onChange={setArtifactFilter}
                />

                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground"
                        onClick={() => {
                            setArtistFilter([]);
                            setDeadlineFrom("");
                            setDeadlineTo("");
                            setMonthFilter("");
                            setArtifactFilter([]);
                        }}
                    >
                        <X className="h-3 w-3 mr-1" /> Clear filters
                    </Button>
                )}
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
            >
                <div className="flex gap-4 overflow-x-auto pb-4 h-full">
                    {columns.map((col) => (
                        <div key={col.key} className="shrink-0 w-[220px]">
                            <Column
                                id={col.key}
                                title={col.label}
                                tasks={col.assets}
                                role={role}
                            />
                        </div>
                    ))}
                </div>

                <DragOverlay>
                    {activeTask ? <TaskCard task={activeTask} role={role} /> : null}
                </DragOverlay>
            </DndContext>

            {isValidating && (
                <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-background/80 backdrop-blur-sm border border-border px-3 py-1.5 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom-2 z-50">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Syncing DB</span>
                </div>
            )}
        </>
    );
}
