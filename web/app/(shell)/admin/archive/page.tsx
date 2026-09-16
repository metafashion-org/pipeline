import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArchiveTable } from "@/components/archive/ArchiveTable";
import { PaymentsBoard } from "@/components/payments/PaymentsBoard";
import { getArchivedAssets, getArchivedTotal } from "@/lib/archive/archive-service";
import { getArtistsPendingPayment } from "@/lib/payments/payment-batch-service";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { History } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

// One page for everything payment-related, rather than splitting the live payout queue and its
// settled history across two sidebar entries. Used to be admin-only (checked the deprecated
// collapsed session.user.role); now gated on canMarkPaymentDone so a payment_admin who isn't a
// full admin can actually reach it, matching who's allowed to act on any of this.
export default async function ArchivePage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string; month?: string }>;
}) {
    const [filters, session] = await Promise.all([searchParams, getServerSession(authOptions)]);
    const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});

    if (!session || !caps.canMarkPaymentDone) {
        redirect("/unauthorized");
    }

    let archive: Awaited<ReturnType<typeof getArchivedAssets>> = { rows: [], total: 0, months: [], truncated: false };
    let archiveTotal: Awaited<ReturnType<typeof getArchivedTotal>> = { total: 0, currencies: [] };
    let pendingArtists: Awaited<ReturnType<typeof getArtistsPendingPayment>> = [];
    try {
        [archive, archiveTotal, pendingArtists] = await Promise.all([
            getArchivedAssets({ q: filters.q, month: filters.month }),
            getArchivedTotal({ q: filters.q, month: filters.month }),
            getArtistsPendingPayment(),
        ]);
    } catch (error) {
        console.error("Error fetching archive/payments data:", error);
    }

    return (
        <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Payments"
        description="Who's owed money right now, and everything already paid out."
      />

            <main className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col gap-6">
            <PaymentsBoard initialArtists={pendingArtists} />

            <Card className="shadow-sm hover:shadow-md transition-shadow">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <History className="h-4 w-4" /> Archive
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">Assets paid out more than 7 days ago.</p>
                </CardHeader>
                <CardContent>
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
