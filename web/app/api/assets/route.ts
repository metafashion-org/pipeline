import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getKanbanBoardData } from "@/lib/kanban/kanban-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { user } = session;
    const isArtistOnly = user.role === "artist" && (!user.roles || !user.roles.includes("admin") && !user.roles.includes("operator"));
    const artistFilterEmail = isArtistOnly ? user.email || undefined : undefined;

    const { columns } = await getKanbanBoardData(artistFilterEmail);

    return NextResponse.json({
      data: columns,
      role: user.role || "artist",
    });
  } catch (error: unknown) {
    console.error("Error fetching kanban board data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch kanban board data" },
      { status: 500 }
    );
  }
}
