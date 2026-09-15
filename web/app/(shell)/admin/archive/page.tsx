import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { Card, CardContent } from "@/components/ui/card";
import { ArchiveTable } from "@/components/archive/ArchiveTable";
import { getArchivedAssets, getArchivedTotal } from "@/lib/archive/archive-service";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

// Used to show "Pending Payments" here too, sourced from a payment_cycles snapshot pulled on the
// 15th/last day of the month. That's gone now — pending payments are a live, per-artist view at
// /admin/payments instead (payments aren't naturally cycle-shaped). This page is just the settled
// history: assets paid out more than 7 days ago.
export default async function ArchivePage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; month?: string }>;
}) {
    const [filters, session] = await Promise.all([searchParams, getServerSession(authOptions)]);

    if (!session || session.user?.role !== "admin") {
        redirect("/unauthorized");
    }

    let archive: Awaited<ReturnType<typeof getArchivedAssets>> = { rows: [], total: 0, months: [], truncated: false };
    let archiveTotal: Awaited<ReturnType<typeof getArchivedTotal>> = { total: 0, currencies: [] };
    try {
        [archive, archiveTotal] = await Promise.all([
            getArchivedAssets({ q: filters.q, month: filters.month }),
            getArchivedTotal({ q: filters.q, month: filters.month }),
        ]);
    } catch (error) {
        console.error("Error fetching archived tasks:", error);
    }

    return (
        <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Archive"
        description="Assets paid out more than 7 days ago. Looking for what's owed right now? See Payments."
      />

            <main className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col gap-6">
            <Card className="shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                {/* ArchiveTable reads the query string with useSearchParams. Without a Suspense
                    boundary that hook forces the whole route into client-side rendering during
                    prerender, and Next errors on it in a static build. The page is
                    force-dynamic today, so this is the boundary that keeps it from breaking the
                    moment that changes. */}
                <Suspense fallback={<div className="py-6 text-sm text-muted-foreground">Loading archive…</div>}>
                <ArchiveTable
                    rows={archive.rows.map((r) => ({
                        id: r.id,
                        sku: r.sku,
                        title: r.title,
                        assignedTo: r.assignedTo,
                        feeAmount: r.feeAmount,
                        currency: r.currency,
                        paymentReceiptUrl: r.paymentReceiptUrl,
                        paidAt: r.paidAt ? new Date(r.paidAt).toISOString() : null,
                    }))}
                    total={archive.total}
                    months={archive.months}
                    truncated={archive.truncated}
                    paidTotal={archiveTotal.total}
                    paidCurrencies={archiveTotal.currencies}
                />
                </Suspense>
                </CardContent>
            </Card>
            </main>
        </div>
    );
}
