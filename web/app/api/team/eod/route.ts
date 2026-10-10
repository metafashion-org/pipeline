import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { EodInputError, getEod, getEodReference, saveEod } from "@/lib/team-tasks/eod-service";
import { findTeamMember } from "@/lib/team-tasks/team-members";
import { teamDay } from "@/lib/team-tasks/task-rules";
import { getTeamRhythm } from "@/lib/team-tasks/team-rhythm";

export const dynamic = "force-dynamic";

const MAX_BOX_CHARS = 5_000;
const box = z.string().max(MAX_BOX_CHARS).default("");
const EodSchema = z.object({ done: box, slipped: box, blockers: box, needFromManager: box, nextOutcome: box });

// Only people on the full-time team write an EOD; it is always their own, for today.
async function teamCaller() {
  const user = await getAuthedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!user.caps.canUseTeamTasks) return { error: teamTasksForbidden() };
  const member = user.personnelId ? await findTeamMember(user.personnelId) : null;
  if (!member) return { error: NextResponse.json({ error: "Only people on the full-time team write an EOD" }, { status: 403 }) };
  return { member };
}

/** The caller's EOD for today (if written), when it's due, and their plans for reference. */
export async function GET() {
  const auth = await teamCaller();
  if (auth.error) return auth.error;
  const today = teamDay(new Date());
  const rhythm = await getTeamRhythm();
  const [report, reference] = await Promise.all([getEod(auth.member.id, today), getEodReference(auth.member.id, today, rhythm)]);
  return NextResponse.json({ today, dueTime: rhythm.eodDueTime, summaryTime: rhythm.summaryTime, report, ...reference });
}

/** Saves the caller's EOD for today. Saving again updates it and keeps the time it was first sent. */
export async function PUT(request: Request) {
  const auth = await teamCaller();
  if (auth.error) return auth.error;
  const parsed = EodSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Each box holds up to 5,000 characters" }, { status: 400 });
  const now = new Date();
  try {
    const report = await saveEod(auth.member.id, teamDay(now), parsed.data, now);
    return NextResponse.json({ report });
  } catch (error) {
    if (error instanceof EodInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
