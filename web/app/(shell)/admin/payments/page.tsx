import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { getArtistsPendingPayment } from "@/lib/payments/payment-batch-service";
import { PaymentsBoard } from "@/components/payments/PaymentsBoard";
import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

// Replaces the old "Pending Payments" table on /admin/archive (which read a 15th/30th
// payment_cycles snapshot) with a live, per-artist view: payments here aren't cycle-shaped, an
// artist is owed for whatever's currently marked_for_payment, whenever a payment_admin gets to it.
export default async function PaymentsPage() {
  const session = await getServerSession(authOptions);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !caps.canMarkPaymentDone) {
    redirect("/unauthorized");
  }

  const artists = await getArtistsPendingPayment();

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Payments"
        description="Every artist owed money, grouped with what they're owed. Attach the bank's payout summary to mark a batch paid."
      />

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <PaymentsBoard initialArtists={artists} />
      </main>
    </div>
  );
}
