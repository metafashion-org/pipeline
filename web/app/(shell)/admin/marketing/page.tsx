import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getMarketingKanbanData } from "@/lib/marketing/marketing-kanban-service";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { MarketingTracker } from "@/components/marketing/MarketingTracker";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminMarketingPage() {
  const session = await getServerSession(authOptions);

  if (!session || (session.user?.role !== "admin" && session.user?.role !== "marketing")) {
    redirect("/unauthorized");
  }

  type KanbanData = Awaited<ReturnType<typeof getMarketingKanbanData>>;
  let kanbanData: KanbanData = { statusColumns: [], updates: [], uploadedNotMarketedAssets: [] };
  try {
    kanbanData = await getMarketingKanbanData();
  } catch (error) {
    console.error("Error loading marketing kanban data:", error);
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Marketing Kanban & Campaign Dashboard</h1>
          <span className="hidden sm:inline text-xs text-muted-foreground">Posts and promotion status for assets that have reached Roblox. Filter by what still needs marketing.</span>
          <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
            {session.user.email}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-6">
        <MarketingTracker
          statusColumns={kanbanData.statusColumns.map((c) => ({ id: c.id, statusKey: c.statusKey, label: c.label }))}
          initialUpdates={kanbanData.updates.map((u) => ({
            updateId: u.updateId,
            assetId: u.assetId,
            sku: u.sku,
            itemName: u.itemName,
            campaign: u.campaign,
            platform: u.platform,
            postType: u.postType,
            postUrl: u.postUrl,
            creative: u.creative,
            caption: u.caption,
            marketingStatus: u.marketingStatus,
            postedAt: u.postedAt ? u.postedAt.toISOString() : null,
            highPerforming: u.highPerforming,
            notes: u.notes,
            nextAction: u.nextAction,
            createdAt: u.createdAt.toISOString(),
          }))}
          unmarketedAssets={kanbanData.uploadedNotMarketedAssets.map((a) => ({
            id: a.id,
            sku: a.sku,
            itemName: a.itemName,
            category: a.category,
            currentStatus: a.currentStatus,
          }))}
        />
      </main>
    </div>
  );
}
