import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { AssetCalendar } from "@/components/calendar/AssetCalendar";
import { TaskCalendar } from "@/components/calendar/TaskCalendar";

export const dynamic = "force-dynamic";

const TASKS_VIEW = "tasks";

// One calendar with two views: asset uploads (anyone who sees every asset, like the board) and Team
// Tasks (the full-time team's planned days and due dates). ?view=tasks picks the second.
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [session, { view }] = await Promise.all([getServerSession(authOptions), searchParams]);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !(caps.canViewAllAssets || caps.canUseTeamTasks)) redirect("/unauthorized");
  const showTasks = caps.canUseTeamTasks && (view === TASKS_VIEW || !caps.canViewAllAssets);

  const tabs = [
    ...(caps.canViewAllAssets ? [{ href: "/admin/calendar", label: "Asset uploads", active: !showTasks }] : []),
    ...(caps.canUseTeamTasks ? [{ href: `/admin/calendar?view=${TASKS_VIEW}`, label: "Tasks", active: showTasks }] : []),
  ];

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Calendar"
        description={showTasks ? "What each person planned to work on each day, and when tasks are due." : "Artist deadlines, planned uploads and go-live dates for every asset."}
      />
      <main className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
        {tabs.length > 1 && (
          <div className="inline-flex rounded-md border p-0.5">
            {tabs.map((tab) => (
              <Link key={tab.href} href={tab.href} className={cn("rounded px-3 py-1 text-sm", tab.active ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {tab.label}
              </Link>
            ))}
          </div>
        )}
        {showTasks ? <TaskCalendar /> : <AssetCalendar />}
      </main>
    </div>
  );
}
