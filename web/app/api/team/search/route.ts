import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { searchTeamTasks } from "@/lib/team-tasks/team-board";
import { teamTasksForbidden } from "@/lib/team-tasks/route-errors";

export const dynamic = "force-dynamic";

/** Searches every task, done ones included, by title, notes and comments (?q=). */
export async function GET(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const query = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ results: await searchTeamTasks(query) });
}
