"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { TaskCard } from "./TaskCard";
import { StatusInfoTooltip } from "./status-info-tooltip";

interface ColumnProps {
    id: string;
    title: string;
    whoCanMoveIn?: string | null;
    nextActionHint?: string | null;
    automationNote?: string | null;
    tasks: any[];
    role: string;
    onDelete?: (skuId: string) => void;
    onEdit?: (skuId: string, updates: any) => Promise<void>;
}

export function Column({ id, title, whoCanMoveIn, nextActionHint, automationNote, tasks, role, onDelete, onEdit }: ColumnProps) {
    const { setNodeRef, isOver } = useDroppable({ id });

    return (
        <div className="flex flex-col h-full rounded-lg border border-border bg-card" data-testid={`column-${id}`}>
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                <div className="flex items-center gap-1.5 min-w-0">
                    <h3 className="font-semibold text-sm truncate">
                        {title}
                    </h3>
                    <StatusInfoTooltip
                        statusLabel={title}
                        whoCanMoveIn={whoCanMoveIn}
                        nextActionHint={nextActionHint}
                        automationNote={automationNote}
                    />
                </div>
                <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                    {tasks.length}
                </span>
            </div>

            <div
                ref={setNodeRef}
                className={`flex-1 p-2 overflow-y-auto transition-colors ${isOver ? "bg-accent/50" : ""}`}
            >
                <SortableContext
                    items={tasks.map((t, idx) => t.sku || t.id || `missing-${idx}`)}
                >
                    <div className="flex flex-col flex-1 min-h-[100px] gap-2 p-1">
                        {tasks.map((task, idx) => (
                            <TaskCard
                                key={task.sku || task.id || `missing-${idx}`}
                                task={task}
                                role={role}
                                onDelete={onDelete}
                                onEdit={onEdit}
                            />
                        ))}
                    </div>
                </SortableContext>

                {tasks.length === 0 && (
                    <div className="h-20 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border rounded-lg m-1">
                        Drop items here
                    </div>
                )}
            </div>
        </div>
    );
}
