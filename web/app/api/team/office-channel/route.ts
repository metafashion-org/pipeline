import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { setUpOfficeChannel } from "@/lib/discord/office-channel";
import { listTeamMembers } from "@/lib/team-tasks/team-members";

export const dynamic = "force-dynamic";

/**
 * Makes the Team Tasks office channel on Discord now, instead of waiting for the first mention or
 * summary, and gives everyone on the full-time team access. Admins only: it changes the Discord server.
 */
export async function POST() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Only an admin can set up the office channel" }, { status: 403 });

  const members = await listTeamMembers();
  const url = await setUpOfficeChannel(members.map((m) => m.discordUserId).filter((id): id is string => Boolean(id)));
  if (!url) return NextResponse.json({ error: "Discord isn't set up on this deployment" }, { status: 503 });
  return NextResponse.json({ url, withoutDiscord: members.filter((m) => !m.discordUserId).map((m) => m.name) });
}
