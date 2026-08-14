import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { statusHistory } from "@/lib/db/schema/status_history";
import { paymentCycles } from "@/lib/db/schema/payment_cycles";
import { paymentCycleItems } from "@/lib/db/schema/payment_cycle_items";
import { eq, and, lte, inArray, desc } from "drizzle-orm";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { PendingPaymentControls } from "@/components/archive/PendingPaymentControls";
import { RunPaymentPullButton } from "@/components/archive/RunPaymentPullButton";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", RUB: "₽" };

// Formats a fee amount with its currency symbol, e.g. "$800" / "€1,200" / "₽5,000".
// Input: the raw numeric-string fee and the asset's currency code. Output: a display string, or "Not set" when there's no fee.
function formatFee(fee: string | null, currency: string | null): string {
  if (!fee) return "Not set";
  const symbol = CURRENCY_SYMBOLS[currency || "USD"] || "$";
  const amount = Number(fee);
  return Number.isFinite(amount) ? `${symbol}${amount.toLocaleString("en-US")}` : `${symbol}${fee}`;
}

interface ArchivedTask {
    id: string;
    sku: string;
    title: string;
    updatedAt: Date;
    assignedTo: string | null;
}

interface PendingPayment {
    id: string;
    sku: string;
    title: string;
    currentStatus: string;
    artistName: string | null;
    feeAmount: string | null;
    currency: string | null;
    paymentReceiptUrl: string | null;
    since: Date | null;
}

export default async function ArchivePage() {
    const session = await getServerSession(authOptions);

    if (!session || session.user?.role !== "admin") {
        redirect("/unauthorized");
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    let tasks: ArchivedTask[] = [];
    let pendingPayments: PendingPayment[] = [];
    let latestCycleDate: string | null = null;
    try {
        const rows = await db
            .select({
                id: assets.id,
                sku: assets.sku,
                title: assets.itemName,
                updatedAt: assets.updatedAt,
                assignedTo: personnel.name,
            })
            .from(assets)
            .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
            .where(and(eq(assets.currentStatus, "payment_done"), lte(assets.updatedAt, sevenDaysAgo)));

        tasks = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

        // Pending Payments: who to pay, how much, and since when they entered
        // marked_for_payment/uploaded_to_roblox. This used to be a live continuous
        // query, but the client only pays out on a scheduled pull (the 15th and the
        // last day of the month, see lib/payments/payment-cycle-service.ts) — so this
        // now reads the latest payment_cycles run's items instead, joined against
        // current asset data for fee/receipt-attached status since payment can still
        // be marked done after the pull ran.
        const [latestCycle] = await db
            .select()
            .from(paymentCycles)
            .orderBy(desc(paymentCycles.cycleDate), desc(paymentCycles.createdAt))
            .limit(1);

        if (latestCycle) {
            latestCycleDate = latestCycle.cycleDate;

            const pendingRows = await db
                .select({
                    id: assets.id,
                    sku: assets.sku,
                    title: assets.itemName,
                    currentStatus: assets.currentStatus,
                    artistName: personnel.name,
                    feeAmount: assets.feeAmount,
                    currency: assets.currency,
                    paymentReceiptUrl: assets.paymentReceiptUrl,
                })
                .from(paymentCycleItems)
                .innerJoin(assets, eq(paymentCycleItems.assetId, assets.id))
                .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
                .where(eq(paymentCycleItems.cycleId, latestCycle.id));

            const sinceByAssetId = new Map<string, Date>();
            if (pendingRows.length > 0) {
                const historyRows = await db
                    .select({ assetId: statusHistory.assetId, toStatus: statusHistory.toStatus, createdAt: statusHistory.createdAt })
                    .from(statusHistory)
                    .where(inArray(statusHistory.assetId, pendingRows.map((r) => r.id)))
                    .orderBy(desc(statusHistory.createdAt));
                for (const row of pendingRows) {
                    const match = historyRows.find((h) => h.assetId === row.id && h.toStatus === row.currentStatus);
                    if (match) sinceByAssetId.set(row.id, match.createdAt);
                }
            }

            pendingPayments = pendingRows
                .map((r) => ({ ...r, since: sinceByAssetId.get(r.id) ?? null }))
                .sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0));
        }
    } catch (error) {
        console.error("Error fetching archived tasks:", error);
    }

    return (
        <div className="flex flex-col h-screen bg-background text-foreground">
            <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Button variant="ghost" size="icon" asChild>
                        <Link href="/admin">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                    </Button>
                    <h1 className="text-lg font-semibold truncate">Task Archive</h1>
                    <span className="hidden sm:inline text-xs text-muted-foreground truncate">Assets paid out more than 7 days ago, kept for reference</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <ModeToggle />
                    <LogoutButton />
                </div>
            </header>

            <main className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col gap-6">
            <Card className="shadow-sm hover:shadow-md transition-all">
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                    <div>
                        <CardTitle>Pending Payments</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            {latestCycleDate
                                ? `Who to pay, how much, and since when — from the ${new Date(latestCycleDate).toLocaleDateString()} payout pull. Client pays out on the 15th and the last day of each month.`
                                : "Who to pay, how much, and since when. Client pays out on the 15th and the last day of each month."}
                        </p>
                    </div>
                    <RunPaymentPullButton />
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>SKU</TableHead>
                                <TableHead>Title</TableHead>
                                <TableHead>Artist</TableHead>
                                <TableHead>Fee</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Since</TableHead>
                                <TableHead>Payment Receipt</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {!latestCycleDate ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                                        No payment cycle has run yet. Click &quot;Run pull now&quot; to pull the current pending payments, or wait for the next scheduled pull.
                                    </TableCell>
                                </TableRow>
                            ) : pendingPayments.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center h-24">
                                        No pending payments in the latest cycle.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                pendingPayments.map((p) => (
                                    <TableRow key={p.id}>
                                        <TableCell className="font-mono text-sm">{p.sku}</TableCell>
                                        <TableCell className="font-medium">{p.title}</TableCell>
                                        <TableCell>{p.artistName || "Unassigned"}</TableCell>
                                        <TableCell>{formatFee(p.feeAmount, p.currency)}</TableCell>
                                        <TableCell>
                                            {p.currentStatus === "payment_done" ? (
                                                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                                    Payment Done
                                                </Badge>
                                            ) : (
                                                <Badge variant={p.currentStatus === "marked_for_payment" ? "default" : "secondary"}>
                                                    {p.currentStatus === "marked_for_payment" ? "Marked for Payment" : "Uploaded to Roblox"}
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">{p.since ? p.since.toLocaleDateString() : "N/A"}</TableCell>
                                        <TableCell>
                                            <PendingPaymentControls sku={p.sku} currency={p.currency} paymentReceiptUrl={p.paymentReceiptUrl} />
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card className="shadow-sm hover:shadow-md transition-all">
                <CardHeader>
                    <CardTitle>Task Archive</CardTitle>
                </CardHeader>
                <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead>Last Updated</TableHead>
                            <TableHead>Assigned To</TableHead>
                            <TableHead>Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {tasks.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center h-24">
                                    No archived tasks found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            tasks.map((task) => (
                                <TableRow key={task.id}>
                                    <TableCell className="font-mono text-sm">{task.sku}</TableCell>
                                    <TableCell className="font-medium">{task.title}</TableCell>
                                    <TableCell>{task.updatedAt.toLocaleDateString()}</TableCell>
                                    <TableCell>{task.assignedTo || "Unassigned"}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                            Payment Done
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
                </CardContent>
            </Card>
            </main>
        </div>
    );
}
