import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getKanbanBoardData, KanbanColumnData } from "@/lib/kanban/kanban-service";
import { Board } from "@/components/kanban/Board";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { redirect } from "next/navigation";

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
        <div className="flex flex-col h-screen bg-background text-foreground">
            <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <h1 className="text-lg font-semibold truncate">Admin Kanban Board</h1>
                    <span className="hidden sm:inline-flex text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium truncate">
                        {session.user.email}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <ModeToggle />
                    <LogoutButton />
                </div>
            </header>

            <main className="flex-1 overflow-hidden p-4 sm:p-6">
                <Board
                    initialColumns={initialColumns}
                    role="admin"
                />
            </main>
        </div>
    );
}
