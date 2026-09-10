import { getAuthedUser } from "@/lib/auth/authed-user";
import { getMarketingViewSafe } from "@/lib/dashboard/views";
import { MarketingTracker } from "@/components/marketing/MarketingTracker";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

export default async function AdminMarketingPage() {
  // Same dead condition as the API route this page posts to: role can never be "marketing".
  const user = await getAuthedUser();
  if (!user?.caps.canAccessMarketingTools) {
    redirect("/unauthorized");
  }

  // Cached under the marketing tag and invalidated by the marketing-updates route and by a Roblox upload, which is what puts a new asset in the "uploaded but not marketed" list.
  const kanbanData = await getMarketingViewSafe();

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Marketing"
        description="Posts and promotion status for assets that have reached Roblox."
      />

      <main className="flex-1 overflow-hidden p-6">
        <MarketingTracker
          statusColumns={kanbanData.statusColumns}
          initialUpdates={kanbanData.updates}
          unmarketedAssets={kanbanData.unmarketedAssets}
        />
      </main>
    </div>
  );
}
