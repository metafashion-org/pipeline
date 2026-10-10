import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { getTaskCalendar } from "@/lib/team-tasks/team-board";
import { listTeamMembers } from "@/lib/team-tasks/team-members";

export const dynamic = "force-dynamic";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Planned days and due dates of Team Tasks between ?from and ?to (inclusive), and the team. */
export async function GET(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  const params = new URL(request.url).searchParams;
  const from = DAY.safeParse(params.get("from"));
  const to = DAY.safeParse(params.get("to"));
  if (!from.success || !to.success) return NextResponse.json({ error: "Send from and to as YYYY-MM-DD" }, { status: 400 });
  const [entries, members] = await Promise.all([getTaskCalendar(from.data, to.data, user.personnelId ?? null), listTeamMembers()]);
  return NextResponse.json({ entries, members: members.map((m) => ({ id: m.id, name: m.name })) });
}
