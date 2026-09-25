import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/layout/PageHeader";
import { AssetCalendar } from "@/components/calendar/AssetCalendar";

export const dynamic = "force-dynamic";

// Same audience as the board: anyone who sees every asset.
export default async function CalendarPage() {
  const session = await getServerSession(authOptions);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !caps.canViewAllAssets) redirect("/unauthorized");

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Asset Calendar"
        description="Artist deadlines, planned uploads and go-live dates for every asset."
      />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <AssetCalendar />
      </main>
    </div>
  );
}
