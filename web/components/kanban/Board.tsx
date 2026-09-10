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
import { Loader2, X } from "lucide-react";

import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { toast } from "sonner";
// The client types, not the server ones: the two date fields are Dates when this came from the
// server render and ISO strings when SWR refetched it.
import type { KanbanColumnDataClient, KanbanAssetCardClient } from "@/lib/kanban/kanban-service";
import { jsonFetcher } from "@/lib/fetcher";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface BoardProps {
    initialColumns?: KanbanColumnDataClient[];
    role: string;
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

    // Filters — artist-wise and deadline-date-wise, both requested from the
    // team meeting notes. Purely client-side: the data's already loaded, so
    // filtering it again over the network would just be added latency for
    // no reason. "Deadline from/to" rather than a single date, since a
    // range covers both "what's due this week" and "what's due today"
    // without needing two different controls.
    const [artistFilter, setArtistFilter] = useState<string>("all");
    const [deadlineFrom, setDeadlineFrom] = useState<string>("");
    const [deadlineTo, setDeadlineTo] = useState<string>("");

    const allArtists = Array.from(
        new Set(allColumns.flatMap((c) => c.assets.map((a) => a.artistName).filter((n): n is string => !!n)))
    ).sort();

    const hasActiveFilters = artistFilter !== "all" || deadlineFrom !== "" || deadlineTo !== "";

    const columns: KanbanColumnDataClient[] = hasActiveFilters
        ? allColumns.map((col) => ({
              ...col,
              assets: col.assets.filter((a) => {
                  if (artistFilter !== "all" && a.artistName !== artistFilter) return false;
                  if (deadlineFrom || deadlineTo) {
                      if (!a.deadline) return false;
                      const d = new Date(a.deadline);
                      if (deadlineFrom && d < new Date(deadlineFrom)) return false;
                      if (deadlineTo && d > new Date(`${deadlineTo}T23:59:59`)) return false;
                  }
                  return true;
              }),
          }))
        : allColumns;

    useEffect(() => {
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
        try {
            const response = await fetch(`/api/assets/${sku}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Failed to update status");
            }
            toast.success("Task status updated successfully");
            mutate();
        } catch (error: unknown) {
            console.error(error);
            const message = error instanceof Error ? error.message : "Failed to update task";
            toast.error(message);
            mutate({ data: previousColumns }, false);
        }
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
                <Select value={artistFilter} onValueChange={setArtistFilter}>
                    <SelectTrigger className="w-[160px] h-8 text-xs">
                        <SelectValue placeholder="All artists" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All artists</SelectItem>
                        {allArtists.map((name) => (
                            <SelectItem key={name} value={name}>
                                {name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

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

                {hasActiveFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground"
                        onClick={() => {
                            setArtistFilter("all");
                            setDeadlineFrom("");
                            setDeadlineTo("");
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
                        <div key={col.key} className="shrink-0 w-[280px]">
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
