import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canManageKnowledge } from "@/lib/auth/rbac";
import { listTasksLinkedToArtifact } from "@/lib/team-tasks/team-board";

export const dynamic = "force-dynamic";

/** The Team Tasks linked to a Registry artifact, e.g. the work an insight turned into. */
export async function GET(_request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const [{ artifactId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageKnowledge(user.caps) && !user.caps.canUseTeamTasks) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!z.uuid().safeParse(artifactId).success) return NextResponse.json({ error: "Unknown artifact" }, { status: 404 });

  return NextResponse.json({ tasks: await listTasksLinkedToArtifact(artifactId) });
}
