"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { formatDate } from "@/lib/format-date";

export interface ArchivedTaskRow {
    id: string;
    sku: string;
    title: string;
    paidAt: string | null;
    assignedTo: string | null;
    feeAmount: string | null;
    currency: string | null;
    paymentReceiptUrl: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", INR: "₹", RUB: "₽" };

function formatFee(fee: string | number | null, currency: string | null): string {
    if (fee === null || fee === "") return "-";
    const symbol = CURRENCY_SYMBOLS[currency || "INR"] || "";
    const amount = Number(fee);
    return Number.isFinite(amount) ? `${symbol}${amount.toLocaleString("en-US")}` : `${symbol}${fee}`;
}

const ALL_MONTHS = "all";

/**
 * Turns a "2026-08" key into "August 2026".
 * Built with Date.UTC rather than the local-time constructor: new Date(2026, 7, 1) is local midnight, which formatting in UTC then rolls back into the previous month for anyone east of Greenwich. That is how this label read "July" for August in IST.
 */
function monthLabel(key: string): string {
    const [year, month] = key.split("-");
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    return `${date.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${year}`;
}

/**
 * The paid-out archive.
 *
 * Filtering runs in SQL rather than the browser, because the archive only ever grows: every asset that gets paid stays in it forever, so filtering client-side would mean shipping the entire history to every visitor. The controls write to the URL and the server component re-queries, which also makes any filtered view shareable and reloadable.
 *
 * Input: one capped page of matching rows plus the true totals behind them. Output: the table, the controls, and an honest note when more rows match than were loaded.
 */
export function ArchiveTable({
    rows,
    total,
    months,
    truncated,
    paidTotal,
    paidCurrencies,
}: {
    rows: ArchivedTaskRow[];
    total: number;
    months: string[];
    truncated: boolean;
    paidTotal: number;
    paidCurrencies: string[];
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    const urlQuery = searchParams.get("q") || "";
    const month = searchParams.get("month") || ALL_MONTHS;
    const [query, setQuery] = useState(urlQuery);

    // Keep the box in step when the URL changes from elsewhere, such as the back button.
    useEffect(() => setQuery(urlQuery), [urlQuery]);

    function pushParams(next: { q?: string; month?: string }) {
        const params = new URLSearchParams(searchParams.toString());
        for (const [key, value] of Object.entries(next)) {
            if (!value || value === ALL_MONTHS) params.delete(key);
            else params.set(key, value);
        }
        const qs = params.toString();
        startTransition(() => router.replace(qs ? `?${qs}` : "?", { scroll: false }));
    }

    // Typing should not fire a query per keystroke, so the URL is only updated once typing pauses.
    useEffect(() => {
        if (query === urlQuery) return;
        const timer = setTimeout(() => pushParams({ q: query }), 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    const isFiltered = Boolean(urlQuery) || month !== ALL_MONTHS;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search SKU, item, or artist"
                        className="h-9 pl-8"
                        aria-label="Search the archive"
                    />
                </div>
                <Select value={month} onValueChange={(v) => pushParams({ month: v })}>
                    <SelectTrigger className="h-9 w-[170px]" aria-label="Filter by month">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL_MONTHS}>All months</SelectItem>
                        {months.map((m) => (
                            <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {isFiltered && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setQuery(""); startTransition(() => router.replace("?", { scroll: false })); }}
                    >
                        Clear
                    </Button>
                )}
                <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    {total} paid
                    {paidTotal > 0 && paidCurrencies.length === 1 && <>, {formatFee(paidTotal, paidCurrencies[0])} total</>}
                </span>
            </div>

            {truncated && (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    Showing the {rows.length} most recent of {total} matches. Narrow the search or pick a month to see the rest.
                </p>
            )}

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Artist</TableHead>
                        <TableHead className="text-right">Fee</TableHead>
                        <TableHead>Paid</TableHead>
                        <TableHead>Receipt</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                {isFiltered ? "No rows match that search." : "No archived tasks yet."}
                            </TableCell>
                        </TableRow>
                    ) : (
                        rows.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                                <TableCell className="font-medium">{row.title}</TableCell>
                                <TableCell className="text-sm">{row.assignedTo || "Unassigned"}</TableCell>
                                <TableCell className="text-right text-sm tabular-nums">
                                    {formatFee(row.feeAmount, row.currency)}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">{formatDate(row.paidAt)}</TableCell>
                                <TableCell>
                                    {row.paymentReceiptUrl ? (
                                        <a
                                            href={row.paymentReceiptUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-4"
                                        >
                                            Receipt <ExternalLink className="h-3 w-3" />
                                        </a>
                                    ) : (
                                        <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                                            None attached
                                        </Badge>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
}
