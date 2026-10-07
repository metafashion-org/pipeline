"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Loader2, X, ChevronDown, Filter, Archive, CheckSquare } from "lucide-react";

import { Column, type DropState } from "./Column";
import { TaskCard } from "./TaskCard";
import { AssignTaskDialog } from "./AssignTaskDialog";
import { BoardRulesProvider, ToneLegend, toMoveCard } from "./board-rules";
import { HiddenCardsButton } from "./board-visibility-buttons";
import { ArchiveCardsDialog } from "./ArchiveCardsDialog";
import { RemindButton } from "./RemindButton";
import { useViewerAsActor, useViewerCapabilities } from "@/components/providers/ViewerProvider";
import { allowedTargets, describeColumn, type MoveRule, type MoveStatus } from "@/lib/kanban/move-rules";
import { toast } from "sonner";
// The client types, not the server ones: the two date fields are Dates when this came from the
// server render and ISO strings when SWR refetched it.
import type { KanbanColumnDataClient, KanbanAssetCardClient } from "@/lib/kanban/kanban-service";
import { jsonFetcher } from "@/lib/fetcher";
import { isTrialBotTurn } from "@/lib/trial/trial-sku";
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
    /** Every status_transition_rules row, for explaining columns and checking moves before they're sent. */
    initialRules?: MoveRule[];
    role: string;
}

// What a refused move sends back besides `error`: see TransitionRefusedError in lib/kanban/transition-errors.ts.
interface MoveRefusalBody {
    code?: string;
    title?: string;
    reason?: string;
    hint?: string;
}

// Long enough to read a reason and a next step; the default toast lifetime is too short for that.
const MOVE_REFUSED_TOAST_MS = 10_000;
const REMIND_ALL_LABELS: Record<string, string> = { approved: "Remind all", ready_for_upload: "Remind uploader" };
// How often the board re-reads itself, and how often while the trial bot is about to move.
const BOARD_REFRESH_MS = 20_000;
const TRIAL_REFRESH_MS = 3_000;

interface StoredFilters {
    artistFilter: string[];
    deadlineFrom: string;
    deadlineTo: string;
    monthFilter: string;
    artifactFilter: string[];
}

// Filters persist per-browser so coming back to the board — later the same day, the next day, or
// after switching to another sidebar section and back — shows the same filtered view rather than
// resetting silently. localStorage rather than the URL: the ask was specifically "even if I just
// come back to this page", not "if someone shares this link", and localStorage survives that
// without needing every filter change to push a new URL. Versioned key so a future change to the
// shape doesn't crash on an old saved value — a fresh empty start beats a fresh error.
const FILTER_STORAGE_KEY = "pipeline:board-filters:v1";

function loadStoredFilters(): StoredFilters | null {
    try {
        const raw = localStorage.getItem(FILTER_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return {
            artistFilter: Array.isArray(parsed.artistFilter) ? parsed.artistFilter : [],
            deadlineFrom: typeof parsed.deadlineFrom === "string" ? parsed.deadlineFrom : "",
            deadlineTo: typeof parsed.deadlineTo === "string" ? parsed.deadlineTo : "",
            monthFilter: typeof parsed.monthFilter === "string" ? parsed.monthFilter : "",
            artifactFilter: Array.isArray(parsed.artifactFilter) ? parsed.artifactFilter : [],
        };
    } catch {
        // Private browsing can make localStorage throw on read; a saved filter is a convenience, not something worth a broken board over.
        return null;
    }
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

export function Board({ initialColumns = [], initialRules = [], role }: BoardProps) {
    const { data: swrResponse, mutate, isValidating } = useSWR<{ data: KanbanColumnDataClient[]; rules?: MoveRule[] }>("/api/assets", jsonFetcher, {
        fallbackData: { data: initialColumns, rules: initialRules },
        // The server component already rendered this board from a fresh query, so revalidating on mount refetched the whole thing immediately and made every visit pay for the same data twice.
        // Focus revalidation and the polling interval still keep it current after that.
        revalidateOnMount: false,
        revalidateOnFocus: true,
        // Every few seconds while the trial bot has a move to make, so the trial card visibly goes
        // through each column instead of seeming stuck for up to 20 seconds.
        refreshInterval: (latest) =>
            latest?.data.some((column) => column.assets.some(isTrialBotTurn)) ? TRIAL_REFRESH_MS : BOARD_REFRESH_MS,
    });

    // Memoised so the rule summaries below are only rebuilt when the board data actually changes.
    const swrColumns = swrResponse?.data;
    const allColumns: KanbanColumnDataClient[] = useMemo(() => swrColumns || initialColumns || [], [swrColumns, initialColumns]);
    const rules: MoveRule[] = swrResponse?.rules ?? initialRules;
    const [activeTask, setActiveTask] = useState<KanbanAssetCardClient | null>(null);
    // The card dropped on Assigned, whose artist is being picked in the Assign dialog.
    const [assignTask, setAssignTask] = useState<KanbanAssetCardClient | null>(null);

    const actor = useViewerAsActor();
    const viewerCapabilities = useViewerCapabilities();
    const statuses: MoveStatus[] = useMemo(
        () => allColumns.map((c) => ({ key: c.key, label: c.label, sortOrder: c.sortOrder, whoCanMoveIn: c.whoCanMoveIn })),
        [allColumns]
    );
    const boardRules = useMemo(() => ({ actor, statuses, rules }), [actor, statuses, rules]);
    const guides = useMemo(
        () => new Map(statuses.map((s) => [s.key, describeColumn(actor, s.key, statuses, rules)])),
        [actor, statuses, rules]
    );
    // Where the dragged card can go, so those columns light up and the rest fade while it's held.
    const dropTargets = useMemo(
        () => (activeTask ? allowedTargets(actor, toMoveCard(activeTask), statuses, rules) : null),
        [actor, activeTask, statuses, rules]
    );
    const dropStateFor = (columnKey: string): DropState => {
        if (!activeTask || !dropTargets || columnKey === activeTask.currentStatus) return null;
        return dropTargets.has(columnKey) ? "allowed" : "blocked";
    };
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
    // Unassigned can fill the board as a grid, to look through every card and archive the ones
    // nobody will make. Only that column expands; the rest of the board is unchanged.
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [archiveOpen, setArchiveOpen] = useState(false);

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
        const saved = loadStoredFilters();
        if (saved) {
            setArtistFilter(saved.artistFilter);
            setDeadlineFrom(saved.deadlineFrom);
            setDeadlineTo(saved.deadlineTo);
            setMonthFilter(saved.monthFilter);
            setArtifactFilter(saved.artifactFilter);
        }
        setMounted(true);
        // Deliberately empty deps: this restores the saved filters once, on first mount. Re-running
        // it on every filter change would fight the save effect below and undo a Clear Filters click.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Saves after the restore above has had its turn (guarded on `mounted`), so this never writes
    // the empty initial state over a filter set that hasn't been loaded from storage yet.
    useEffect(() => {
        if (!mounted) return;
        try {
            const toStore: StoredFilters = { artistFilter, deadlineFrom, deadlineTo, monthFilter, artifactFilter };
            localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(toStore));
        } catch {
            // Same private-browsing possibility as the read above — losing persistence silently beats crashing the board.
        }
    }, [mounted, artistFilter, deadlineFrom, deadlineTo, monthFilter, artifactFilter]);

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
        const { ok, data } = await apiCall<MoveRefusalBody>(`/api/assets/${sku}/status`, {
            method: "PATCH",
            body: { status: newStatus },
        });

        if (!ok) {
            const message = data.error || "Failed to update status";
            console.error(message);
            if (data.code && data.title) {
                // The code is what someone quotes when asking the team why a move was refused.
                toast.error(data.title, {
                    description: (
                        <div className="space-y-1">
                            <p>{[data.reason, data.hint].filter(Boolean).join(" ")}</p>
                            <p className="font-mono text-xs opacity-70">Code: {data.code}</p>
                        </div>
                    ),
                    duration: MOVE_REFUSED_TOAST_MS,
                });
            } else {
                toast.error(message);
            }
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

        // A card reaches Assigned by picking its artist, which sends them the offer, so dropping an
        // unassigned card there opens the Assign dialog instead of moving it.
        if (newStatus === "assigned" && draggedTask.currentStatus === "unassigned" && viewerCapabilities.canAssignArtists) {
            setAssignTask(draggedTask);
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

    const activeFilterCount =
        (artistFilter.length > 0 ? 1 : 0) +
        (deadlineFrom || deadlineTo ? 1 : 0) +
        (monthFilter ? 1 : 0) +
        (artifactFilter.length > 0 ? 1 : 0);

    return (
        <>
            <BoardRulesProvider value={boardRules}>
            <div
                className={`flex flex-wrap items-center gap-2 mb-3 rounded-md ${
                    hasActiveFilters ? "border border-primary/40 bg-primary/5 p-2" : ""
                }`}
            >
                {hasActiveFilters && (
                    <span className="flex items-center gap-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold px-2.5 py-1">
                        <Filter className="h-3 w-3" />
                        {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
                    </span>
                )}
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

                <div className="ml-auto flex items-center gap-2">
                    {viewerCapabilities.canAssignArtists && <HiddenCardsButton />}
                    <ToneLegend />
                </div>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
            >
                {/* relative makes this scroller the containing block for absolutely positioned
                    content inside the columns, like the screen-reader label on each column's "i".
                    Without it those labels were placed against the page, and the columns past the
                    right edge made the whole page scroll sideways, sidebar and header included. */}
                <div className="relative flex gap-4 overflow-x-auto pb-4 h-full">
                    {columns
                        .filter((col) => !expandedKey || col.key === expandedKey)
                        .map((col) => {
                            const isExpanded = col.key === expandedKey;
                            const canArchive = isExpanded && viewerCapabilities.canAssignArtists;
                            // Columns that wait on one person get a "Remind all": the artists in Approved,
                            // the uploader in Ready for Upload.
                            const remindLabel = viewerCapabilities.canAssignArtists && col.assets.length > 0 ? REMIND_ALL_LABELS[col.key] : undefined;
                            return (
                                <div key={col.key} className={isExpanded ? "flex-1 min-w-0" : "shrink-0 w-[220px]"}>
                                    <Column
                                        id={col.key}
                                        title={col.label}
                                        description={col.description}
                                        nextActionHint={col.nextActionHint}
                                        automationNote={col.automationNote}
                                        guide={guides.get(col.key) ?? describeColumn(actor, col.key, statuses, rules)}
                                        dropState={dropStateFor(col.key)}
                                        tasks={col.assets}
                                        role={role}
                                        expanded={isExpanded}
                                        onToggleExpand={
                                            col.key === "unassigned"
                                                ? () => {
                                                      setExpandedKey(isExpanded ? null : col.key);
                                                      setPicking(false);
                                                      setPicked(new Set());
                                                  }
                                                : undefined
                                        }
                                        headerActions={
                                            canArchive ? (
                                                <>
                                                    <Button
                                                        size="sm"
                                                        variant={picking ? "secondary" : "ghost"}
                                                        className="h-7 text-xs"
                                                        onClick={() => {
                                                            setPicking(!picking);
                                                            setPicked(new Set());
                                                        }}
                                                    >
                                                        <CheckSquare className="h-3.5 w-3.5" /> {picking ? "Stop picking" : "Pick cards"}
                                                    </Button>
                                                    {picking && (
                                                        <>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-7 text-xs"
                                                                onClick={() =>
                                                                    setPicked(picked.size === col.assets.length ? new Set() : new Set(col.assets.map((a) => a.sku)))
                                                                }
                                                            >
                                                                {picked.size === col.assets.length && col.assets.length > 0 ? "Clear" : "Pick all"}
                                                            </Button>
                                                            <Button size="sm" className="h-7 text-xs" disabled={picked.size === 0} onClick={() => setArchiveOpen(true)}>
                                                                <Archive className="h-3.5 w-3.5" /> Archive {picked.size || ""}
                                                            </Button>
                                                        </>
                                                    )}
                                                </>
                                            ) : remindLabel ? (
                                                <RemindButton skus={col.assets.map((a) => a.sku)} label={remindLabel} />
                                            ) : undefined
                                        }
                                        selection={
                                            canArchive && picking
                                                ? {
                                                      selected: picked,
                                                      onToggle: (sku) =>
                                                          setPicked((current) => {
                                                              const next = new Set(current);
                                                              if (next.has(sku)) next.delete(sku);
                                                              else next.add(sku);
                                                              return next;
                                                          }),
                                                  }
                                                : undefined
                                        }
                                    />
                                </div>
                            );
                        })}
                </div>

                <DragOverlay>
                    {activeTask ? <TaskCard task={activeTask} role={role} /> : null}
                </DragOverlay>
            </DndContext>
            </BoardRulesProvider>

            {/* Mounted only while open, so each archive starts from the default reason with nothing left over. */}
            {archiveOpen && (
            <ArchiveCardsDialog
                open={archiveOpen}
                onOpenChange={setArchiveOpen}
                cards={allColumns.flatMap((c) => c.assets).filter((a) => picked.has(a.sku)).map((a) => ({ sku: a.sku, itemName: a.itemName }))}
                onArchived={() => {
                    setPicked(new Set());
                    setPicking(false);
                }}
            />
            )}

            {assignTask && (
                <AssignTaskDialog
                    key={assignTask.sku}
                    sku={assignTask.sku}
                    currentArtistId={assignTask.artistId}
                    currentArtistName={assignTask.artistName}
                    currentDeadline={assignTask.deadline}
                    currentFeeAmount={assignTask.feeAmount}
                    currentCurrency={assignTask.currency}
                    open
                    onOpenChange={(open) => {
                        if (!open) setAssignTask(null);
                    }}
                    hideTrigger
                />
            )}

            {isValidating && (
                <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-background/80 backdrop-blur-sm border border-border px-3 py-1.5 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom-2 z-50">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Syncing DB</span>
                </div>
            )}
        </>
    );
}
