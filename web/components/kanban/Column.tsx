"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Maximize2, Minimize2 } from "lucide-react";
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
    /** Shown on a column that can fill the board (Unassigned): toggles between full width and normal. */
    onToggleExpand?: () => void;
    /** True while the column fills the board: its cards show as a grid. */
    expanded?: boolean;
    /** Buttons for the expanded column's header, e.g. Select and Archive. */
    headerActions?: ReactNode;
    /** While picking cards: which are picked, and how to pick one. Each card gets a checkbox. */
    selection?: { selected: Set<string>; onToggle: (sku: string) => void };
}

const DROP_STATE_CLASSES: Record<Exclude<DropState, null>, string> = {
    allowed: "ring-2 ring-emerald-500/70",
    blocked: "opacity-45",
};

export function Column({
    id,
    title,
    description,
    nextActionHint,
    automationNote,
    guide,
    dropState,
    tasks,
    role,
    onToggleExpand,
    expanded = false,
    headerActions,
    selection,
}: ColumnProps) {
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
                    <div className="flex items-center gap-1 shrink-0">
                        {headerActions}
                        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{tasks.length}</span>
                        {onToggleExpand && (
                            <button
                                type="button"
                                onClick={onToggleExpand}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                aria-label={expanded ? `Shrink ${title} back to a column` : `Expand ${title} to fill the board`}
                                title={expanded ? "Back to the board" : "Expand to see every card"}
                            >
                                {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                            </button>
                        )}
                    </div>
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
                    {/* Expanded, the cards fill the width as a grid instead of one long column. */}
                    <div
                        className={
                            expanded
                                ? "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3 p-1 min-h-[100px]"
                                : "flex flex-col flex-1 min-h-[100px] gap-2 p-1"
                        }
                    >
                        {tasks.map((task, idx) => {
                            const card = <TaskCard key={task.sku || task.id || `missing-${idx}`} task={task} role={role} />;
                            if (!selection) return card;
                            const picked = selection.selected.has(task.sku);
                            return (
                                <div key={task.sku || task.id || `missing-${idx}`} className={`relative rounded-lg ${picked ? "ring-2 ring-primary" : ""}`}>
                                    {card}
                                    <input
                                        type="checkbox"
                                        checked={picked}
                                        onChange={() => selection.onToggle(task.sku)}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                        className="absolute left-2 top-2 z-10 h-4 w-4 accent-primary"
                                        aria-label={`Pick ${task.itemName}`}
                                    />
                                </div>
                            );
                        })}
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
