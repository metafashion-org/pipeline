import { Suspense } from "react";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/layout/PageHeader";
import { TeamTasksBoard } from "@/components/team/TeamTasksBoard";

export const dynamic = "force-dynamic";

// Team Tasks: the full-time team's day-to-day work, separate from the asset board. Open to admins
// and anyone with the full_time role (proxy.ts already bounces everyone else).
export default async function TeamTasksPage() {
  const session = await getServerSession(authOptions);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !caps.canUseTeamTasks) redirect("/unauthorized");

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader title="Team Tasks" description="What each person on the team is doing today, and what's next." />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        {/* TeamTasksBoard reads the open task from the query string with useSearchParams, which
            needs a Suspense boundary above it, as the archive page's table does. */}
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
          <TeamTasksBoard />
        </Suspense>
      </main>
    </div>
  );
}
