import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getKanbanBoardData, KanbanColumnData } from "@/lib/kanban/kanban-service";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { Board } from "@/components/kanban/Board";
import { NewAssetDialog } from "@/components/kanban/NewAssetDialog";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

export default async function AdminBoardPage() {
    const session = await getServerSession(authOptions);
    const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});

    // canViewAllAssets, not the deprecated collapsed session.user.role, which only ever holds
    // "admin", "operator" or "artist" — someone whose roles include operator but not admin (a
    // production manager without full admin, granted canViewAllAssets through the operator
    // role) collapses to "operator" and was rejected here even though the sidebar's own
    // isRouteAllowedForRoles check already promises them this page.
    if (!session || !(caps.canViewAllAssets || caps.canManageSystemConfig)) {
        redirect("/unauthorized");
    }

    let initialColumns: KanbanColumnData[] = [];
    try {
        const boardData = await getKanbanBoardData();
        initialColumns = boardData.columns;
    } catch (error) {
        console.error("Error fetching tasks for admin:", error);
    }

    return (
        <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Board"
        description="Every asset in the pipeline, grouped by status."
        actions={<NewAssetDialog />}
      />

            <main className="flex-1 overflow-hidden p-4 sm:p-6">
                <Board
                    initialColumns={initialColumns}
                    role={session.user.role || "artist"}
                />
            </main>
        </div>
    );
}
