"use client";

import { useMemo, useState } from "react";
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
import { ExternalLink, Search } from "lucide-react";
import { formatDate } from "@/lib/format-date";

export interface ArchivedTaskRow {
    id: string;
    sku: string;
    title: string;
    paidAt: string | null;
    updatedAt: string;
    assignedTo: string | null;
    feeAmount: string | null;
    currency: string | null;
    paymentReceiptUrl: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", INR: "₹", RUB: "₽" };

function formatFee(fee: string | null, currency: string | null): string {
    if (!fee) return "-";
    const symbol = CURRENCY_SYMBOLS[currency || "USD"] || "";
    const amount = Number(fee);
    return Number.isFinite(amount) ? `${symbol}${amount.toLocaleString("en-US")}` : `${symbol}${fee}`;
}

const ALL_MONTHS = "all";

/**
 * Turns a timestamp into the "2026-08" key the month filter groups by, and the label it shows.
 * Payment date is used when there is one, falling back to the last update for rows imported before status history was recorded.
 */
function monthKey(row: ArchivedTaskRow): string {
    return (row.paidAt || row.updatedAt).slice(0, 7);
}

function monthLabel(key: string): string {
    const [year, month] = key.split("-");
    return `${new Date(Number(year), Number(month) - 1, 1).toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${year}`;
}

/**
 * The paid-out archive, with the two things it is actually consulted for: finding a specific item, and finding what was paid in a given month.
 * Filtering happens in the browser because the archive is a bounded set that the page already loads in full; adding a round trip per keystroke would be slower, not faster.
 */
export function ArchiveTable({ rows }: { rows: ArchivedTaskRow[] }) {
    const [query, setQuery] = useState("");
    const [month, setMonth] = useState(ALL_MONTHS);

    const months = useMemo(() => {
        const keys = Array.from(new Set(rows.map(monthKey))).filter(Boolean);
        return keys.sort().reverse();
    }, [rows]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rows.filter((row) => {
            if (month !== ALL_MONTHS && monthKey(row) !== month) return false;
            if (!q) return true;
            return (
                row.sku.toLowerCase().includes(q) ||
                row.title.toLowerCase().includes(q) ||
                (row.assignedTo || "").toLowerCase().includes(q)
            );
        });
    }, [rows, query, month]);

    const total = useMemo(
        () => visible.reduce((sum, r) => sum + (Number(r.feeAmount) || 0), 0),
        [visible]
    );

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
                <Select value={month} onValueChange={setMonth}>
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
                {(query || month !== ALL_MONTHS) && (
                    <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setMonth(ALL_MONTHS); }}>
                        Clear
                    </Button>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                    {visible.length} of {rows.length}
                    {total > 0 && <> paid, {formatFee(String(total), visible[0]?.currency || "USD")} total</>}
                </span>
            </div>

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
                    {visible.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                {rows.length === 0 ? "No archived tasks yet." : "Nothing matches that search."}
                            </TableCell>
                        </TableRow>
                    ) : (
                        visible.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                                <TableCell className="font-medium">{row.title}</TableCell>
                                <TableCell className="text-sm">{row.assignedTo || "Unassigned"}</TableCell>
                                <TableCell className="text-right text-sm tabular-nums">
                                    {formatFee(row.feeAmount, row.currency)}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                    {formatDate(row.paidAt || row.updatedAt)}
                                </TableCell>
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
                                        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
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
