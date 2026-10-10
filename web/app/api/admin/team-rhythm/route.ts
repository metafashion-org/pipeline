import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getTeamRhythm, saveTeamRhythm, TeamRhythmSchema } from "@/lib/team-tasks/team-rhythm";

export const dynamic = "force-dynamic";

async function admin() {
  const user = await getAuthedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!user.caps.canManageSystemConfig) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/** The team's planning and EOD settings. Admins only. */
export async function GET() {
  const auth = await admin();
  if (auth.error) return auth.error;
  return NextResponse.json({ rhythm: await getTeamRhythm() });
}

/** Saves the team's planning and EOD settings. Admins only. */
export async function PUT(request: Request) {
  const auth = await admin();
  if (auth.error) return auth.error;
  const parsed = TeamRhythmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the times (HH:MM), the work days and the plan-ahead days (1 to 14)" }, { status: 400 });
  await saveTeamRhythm(parsed.data, auth.user.personnelId ?? null);
  return NextResponse.json({ rhythm: parsed.data });
}
