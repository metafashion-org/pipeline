import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { findTeamLinkOptions } from "@/lib/team-tasks/team-board";
import { teamTasksForbidden } from "@/lib/team-tasks/route-errors";

export const dynamic = "force-dynamic";

/**
 * What a task can be linked to that matches ?q=: other tasks, assets and Registry artifacts.
 * ?from=<taskId> leaves the task itself out.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const from = request.nextUrl.searchParams.get("from");
  const fromTaskId = from && z.uuid().safeParse(from).success ? from : null;
  return NextResponse.json(await findTeamLinkOptions(query, fromTaskId, user.personnelId ?? null));
}
