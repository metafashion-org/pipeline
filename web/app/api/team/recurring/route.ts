import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { createRecurrence, listRecurrences } from "@/lib/team-tasks/recurring-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { RecurrenceSchema } from "./recurrence-schema";

export const dynamic = "force-dynamic";

/** Every repeating task. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  return NextResponse.json({ recurrences: await listRecurrences() });
}

/** Makes a repeating task, e.g. curate 45 assets Monday to Saturday, focus Christmas until 31 Dec. */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();

  const parsed = RecurrenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Fill in the title, owner, kind, days and start date" }, { status: 400 });

  try {
    const id = await createRecurrence(parsed.data, user.personnelId ?? null);
    return NextResponse.json({ id });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
