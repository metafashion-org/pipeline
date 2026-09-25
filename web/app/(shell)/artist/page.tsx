import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getKanbanBoardData, KanbanColumnData } from "@/lib/kanban/kanban-service";
import { Board } from "@/components/kanban/Board";
import { OffersPanel } from "@/components/offers/OffersPanel";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

export default async function ArtistPage() {
    const session = await getServerSession(authOptions);

    if (!session || session.user?.role !== "artist") {
        redirect("/unauthorized");
    }

    let initialColumns: KanbanColumnData[] = [];
    try {
        const boardData = await getKanbanBoardData(session.user.email || undefined);
        initialColumns = boardData.columns;
    } catch (error) {
        console.error("Error fetching tasks for artist:", error);
    }

    return (
        <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="My Tasks"
        description="Assets assigned to you."
      />

            <div className="shrink-0 max-h-[45vh] overflow-y-auto px-4 sm:px-6 pt-4 empty:hidden">
                <OffersPanel />
            </div>

            <main className="flex-1 overflow-hidden p-4 sm:p-6">
                <Board initialColumns={initialColumns} role="artist" />
            </main>
        </div>
    );
}
