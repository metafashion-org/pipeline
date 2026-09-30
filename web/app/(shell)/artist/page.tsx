import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getKanbanBoardData, KanbanColumnData } from "@/lib/kanban/kanban-service";
import type { MoveRule } from "@/lib/kanban/move-rules";
import { Board } from "@/components/kanban/Board";
import { OffersPanel } from "@/components/offers/OffersPanel";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { UploadCloud } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ArtistPage() {
    const session = await getServerSession(authOptions);

    if (!session || session.user?.role !== "artist") {
        redirect("/unauthorized");
    }

    let initialColumns: KanbanColumnData[] = [];
    let initialRules: MoveRule[] = [];
    try {
        const boardData = await getKanbanBoardData(session.user.email || undefined);
        initialColumns = boardData.columns;
        initialRules = boardData.rules;
    } catch (error) {
        console.error("Error fetching tasks for artist:", error);
    }

    return (
        <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="My Tasks"
        description="Assets assigned to you."
        actions={
          <Button size="sm" asChild>
            <Link href="/artist/submit">
              <UploadCloud className="h-3.5 w-3.5" /> Submit final files
            </Link>
          </Button>
        }
      />

            <div className="shrink-0 max-h-[45vh] overflow-y-auto px-4 sm:px-6 pt-4 empty:hidden">
                <OffersPanel />
            </div>

            <main className="flex-1 overflow-hidden p-4 sm:p-6">
                <Board initialColumns={initialColumns} initialRules={initialRules} role="artist" />
            </main>
        </div>
    );
}
