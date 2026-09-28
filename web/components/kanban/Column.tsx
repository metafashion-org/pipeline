"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { TaskCard } from "./TaskCard";
import { StatusInfoTooltip } from "./status-info-tooltip";
import { TONE_STYLES } from "./board-rules";
import type { KanbanAssetCardClient } from "@/lib/kanban/kanban-service";
import type { ColumnGuide } from "@/lib/kanban/move-rules";

/** While a card is dragged: whether it can be dropped on this column. Null when nothing is dragged, or on the card's own column. */
export type DropState = "allowed" | "blocked" | null;

interface ColumnProps {
    id: string;
    title: string;
    description?: string | null;
    nextActionHint?: string | null;
    automationNote?: string | null;
    guide: ColumnGuide;
    dropState: DropState;
    tasks: KanbanAssetCardClient[];
    role: string;
}

const DROP_STATE_CLASSES: Record<Exclude<DropState, null>, string> = {
    allowed: "ring-2 ring-emerald-500/70",
    blocked: "opacity-45",
};

export function Column({ id, title, description, nextActionHint, automationNote, guide, dropState, tasks, role }: ColumnProps) {
    const { setNodeRef, isOver } = useDroppable({ id });
    const tone = TONE_STYLES[guide.next.tone];

    return (
        <div
            className={`flex flex-col h-full rounded-lg border border-border bg-card transition-[opacity,box-shadow] ${dropState ? DROP_STATE_CLASSES[dropState] : ""}`}
            data-testid={`column-${id}`}
            data-drop-state={dropState ?? undefined}
        >
            <div className="px-3 py-2 border-b border-border space-y-0.5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <h3 className="font-semibold text-sm truncate">
                            {title}
                        </h3>
                        <StatusInfoTooltip
                            statusLabel={title}
                            description={description}
                            nextActionHint={nextActionHint}
                            automationNote={automationNote}
                            guide={guide}
                        />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                        {tasks.length}
                    </span>
                </div>
                <p className={`flex items-center gap-1.5 text-[11px] ${tone.text}`}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
                    <span className="truncate">{guide.next.text}</span>
                </p>
            </div>

            <div
                ref={setNodeRef}
                className={`flex-1 p-2 overflow-y-auto transition-colors ${isOver && dropState !== "blocked" ? "bg-accent/50" : ""}`}
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
                            />
                        ))}
                    </div>
                </SortableContext>

                {tasks.length === 0 && (
                    <div className="h-20 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border rounded-lg m-1">
                        {dropState === "blocked" ? "You can't move this card here" : "Drop items here"}
                    </div>
                )}
            </div>
        </div>
    );
}
