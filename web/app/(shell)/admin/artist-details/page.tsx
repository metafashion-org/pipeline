import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { canHandleArtistPayDetails, getEffectiveCapabilities } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/layout/PageHeader";
import { ArtistDetailsAdmin } from "@/components/artist-details/ArtistDetailsAdmin";

export const dynamic = "force-dynamic";

// Artist details for the people who pay artists: who has filled in My details, full details on
// request (logged), approving changes, and reminding artists who haven't filled it in.
export default async function ArtistDetailsPage() {
  const session = await getServerSession(authOptions);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !canHandleArtistPayDetails(caps)) redirect("/unauthorized");

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader title="Artist details" description="Bank, UPI, PAN and documents for each artist. Opening an artist's full details is logged." />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <ArtistDetailsAdmin />
      </main>
    </div>
  );
}
