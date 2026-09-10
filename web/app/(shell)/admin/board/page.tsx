import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getKanbanBoardData, KanbanColumnData } from "@/lib/kanban/kanban-service";
import { Board } from "@/components/kanban/Board";
import { NewAssetDialog } from "@/components/kanban/NewAssetDialog";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

export default async function AdminBoardPage() {
    const session = await getServerSession(authOptions);

    if (!session || session.user?.role !== "admin") {
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
                    role="admin"
                />
            </main>
        </div>
    );
}
