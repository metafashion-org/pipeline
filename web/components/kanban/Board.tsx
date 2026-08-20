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
import { Loader2 } from "lucide-react";

import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { toast } from "sonner";
import { KanbanColumnData, KanbanAssetCard } from "@/lib/kanban/kanban-service";
import { jsonFetcher } from "@/lib/fetcher";

interface BoardProps {
    initialColumns?: KanbanColumnData[];
    role: string;
}

export function Board({ initialColumns = [], role }: BoardProps) {
    const { data: swrResponse, mutate, isValidating } = useSWR<{ data: KanbanColumnData[] }>("/api/assets", jsonFetcher, {
        fallbackData: { data: initialColumns },
        // The server component already rendered this board from a fresh query, so revalidating on mount refetched the whole thing immediately and made every visit pay for the same data twice.
        // Focus revalidation and the polling interval still keep it current after that.
        revalidateOnMount: false,
        revalidateOnFocus: true,
        refreshInterval: 20000,
    });

    const columns: KanbanColumnData[] = swrResponse?.data || initialColumns || [];
    const [activeTask, setActiveTask] = useState<KanbanAssetCard | null>(null);
    const [mounted, setMounted] = useState(false);

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

    const findTask = (sku: string): KanbanAssetCard | null => {
        for (const col of columns) {
            const found = col.assets.find((a) => a.sku === sku || a.id === sku);
            if (found) return found;
        }
        return null;
    };

    const submitStatusUpdate = useCallback(async (
        sku: string,
        newStatus: string,
        previousColumns: KanbanColumnData[]
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

        const previousColumns = [...columns];
        await submitStatusUpdate(draggedTask.sku, newStatus, previousColumns);
    };

    if (!mounted) return null;

    return (
        <>
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
                                tasks={col.assets as any}
                                role={role as any}
                            />
                        </div>
                    ))}
                </div>

                <DragOverlay>
                    {activeTask ? <TaskCard task={activeTask as any} role={role as any} /> : null}
                </DragOverlay>
            </DndContext>

            {isValidating && (
                <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-background/80 backdrop-blur-sm border border-border px-3 py-1.5 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom-2 z-50">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Syncing DB</span>
                </div>
            )}
        </>
    );
}
