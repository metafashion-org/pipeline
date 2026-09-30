import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { listTeamNotifications, markTeamNotificationsRead } from "@/lib/team-tasks/team-notifications";
import { teamTasksForbidden } from "@/lib/team-tasks/route-errors";

export const dynamic = "force-dynamic";

/** The caller's latest Team Tasks notifications and their unread count. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!user.personnelId) return NextResponse.json({ notifications: [], unread: 0 });

  return NextResponse.json(await listTeamNotifications(user.personnelId));
}

/** Marks all of the caller's notifications read. */
export async function POST() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (user.personnelId) await markTeamNotificationsRead(user.personnelId);
  return NextResponse.json({ success: true });
}
