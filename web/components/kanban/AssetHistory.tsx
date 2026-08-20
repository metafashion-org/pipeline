"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowRight, Loader2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { jsonFetcher } from "@/lib/fetcher";
import type { AssetHistoryEntry } from "@/app/api/assets/[skuId]/history/route";
import { formatDateTime } from "@/lib/format-date";

// How many of the most recent entries the drawer shows inline. The rest stay one click away in the full log rather than turning the drawer into a scroll well.
const INLINE_ENTRY_LIMIT = 6;

function humanizeStatus(key: string | null | undefined): string {
    if (!key) return "nothing";
    return key.replace(/_/g, " ");
}

// Action keys are stored as camelCase verbs ("updateAsset", "assignArtist"). Spacing the words out keeps the timeline readable without maintaining a label table that drifts as new actions are added.
function humanizeAction(action: string): string {
    return action.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function formatValue(value: unknown): string {
    if (value === null || value === undefined || value === "") return "empty";
    return String(value);
}

/**
 * Shows one asset's trail: status moves and audited edits interleaved, newest first.
 * Loads only when the drawer opens, so opening a card does not pay for history nobody scrolled to.
 */
export function AssetHistory({ sku, enabled }: { sku: string; enabled: boolean }) {
    const { data, error, isLoading } = useSWR<{ history?: AssetHistoryEntry[]; error?: string }>(
        enabled ? `/api/assets/${encodeURIComponent(sku)}/history` : null,
        jsonFetcher
    );

    if (isLoading) {
        return (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading history...
            </p>
        );
    }

    if (error || data?.error) {
        return <p className="text-xs text-destructive">{data?.error || "Couldn't load history"}</p>;
    }

    const history = data?.history || [];
    if (history.length === 0) {
        return <p className="text-xs text-muted-foreground italic">Nothing recorded for this asset yet.</p>;
    }

    const recent = history.slice(0, INLINE_ENTRY_LIMIT);
    const remaining = history.length - recent.length;

    return (
        <div className="space-y-3">
            <HistoryList entries={recent} />
            {remaining > 0 && <FullLogDialog sku={sku} history={history} remaining={remaining} />}
        </div>
    );
}

function HistoryList({ entries }: { entries: AssetHistoryEntry[] }) {
    return (
        <ol className="space-y-2.5">
            {entries.map((entry) => (
                <li key={`${entry.kind}-${entry.id}`} className="border-l-2 border-border pl-3 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-foreground capitalize">
                            {entry.kind === "status" ? (
                                <span className="inline-flex items-center gap-1">
                                    {humanizeStatus(entry.fromStatus)}
                                    <ArrowRight className="h-3 w-3 shrink-0" />
                                    {humanizeStatus(entry.toStatus)}
                                </span>
                            ) : (
                                humanizeAction(entry.action || "change")
                            )}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatDateTime(entry.at)}
                        </span>
                    </div>

                    {entry.changes && Object.keys(entry.changes).length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                            {Object.entries(entry.changes).map(([field, change]) => (
                                <li key={field}>
                                    <span className="font-mono text-[10px]">{field}</span>: {formatValue(change.from)}
                                    <ArrowRight className="mx-1 inline h-2.5 w-2.5" />
                                    {formatValue(change.to)}
                                </li>
                            ))}
                        </ul>
                    )}

                    {entry.note && <p className="mt-0.5 text-muted-foreground">{entry.note}</p>}

                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {entry.actorName || "System"}
                    </p>
                </li>
            ))}
        </ol>
    );
}

/**
 * Holds the entries beyond the inline limit.
 * The data is already loaded by the time this renders, so opening it costs nothing extra.
 */
function FullLogDialog({ sku, history, remaining }: { sku: string; history: AssetHistoryEntry[]; remaining: number }) {
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full text-xs" data-testid="view-full-log">
                    View full log ({remaining} more)
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>History for {sku}</DialogTitle>
                    <DialogDescription>
                        {history.length} entries, newest first.
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto pr-1">
                    <HistoryList entries={history} />
                </div>
            </DialogContent>
        </Dialog>
    );
}
