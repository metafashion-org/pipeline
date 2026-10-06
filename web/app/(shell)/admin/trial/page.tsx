import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrialRunGuide } from "@/components/trial/TrialRunGuide";

export const dynamic = "force-dynamic";

// The trial run: a guided walk through the whole asset pipeline on a test asset, with a bot playing
// the artist (lib/trial/trial-run.ts). For the team who assign artists.
export default async function TrialRunPage() {
  const session = await getServerSession(authOptions);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !caps.canAssignArtists) redirect("/unauthorized");

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader title="Trial run" description="Take a test asset from offer to payment. A bot plays the artist; you do the team's part." />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <TrialRunGuide />
      </main>
    </div>
  );
}
