import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { updateRecurrence } from "@/lib/team-tasks/recurring-service";
import { teamTaskErrorResponse, teamTasksForbidden } from "@/lib/team-tasks/route-errors";
import { RecurrenceSchema } from "../recurrence-schema";

export const dynamic = "force-dynamic";

/**
 * Replaces a repeating task's rule, e.g. a new focus for the next season, or switching it off.
 * Tasks it already made are unchanged.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ recurrenceId: string }> }) {
  const [{ recurrenceId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canUseTeamTasks) return teamTasksForbidden();
  if (!z.uuid().safeParse(recurrenceId).success) return NextResponse.json({ error: "Unknown repeating task" }, { status: 404 });

  const parsed = RecurrenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Fill in the title, owner, kind, days and start date" }, { status: 400 });

  try {
    await updateRecurrence(recurrenceId, parsed.data, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
