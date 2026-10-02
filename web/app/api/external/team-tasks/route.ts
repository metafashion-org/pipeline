import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiKey } from "@/lib/api-keys/api-key-service";
import { createTeamTask } from "@/lib/team-tasks/team-tasks-service";
import { listTeamMembers, resolveTeamMember } from "@/lib/team-tasks/team-members";
import { teamTaskErrorResponse } from "@/lib/team-tasks/route-errors";
import { TEAM_TASK_AREAS, teamDay } from "@/lib/team-tasks/task-rules";

export const dynamic = "force-dynamic";

// This route is the one exception to "every API route calls getAuthedUser()": outside tools
// (Instinct) have no Google sign-in, so they send an API key made in Settings instead. A key can
// only list the team and add Team Tasks.

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_CHARS = 300;
const MAX_NOTES_CHARS = 20_000;
const MAX_HELPERS = 10;

const ExternalTaskSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  // An id, email or name, e.g. "Jayesh".
  owner: z.string().trim().min(1),
  // An area key or label, e.g. "ops" or "Marketing".
  area: z.string().trim().min(1),
  dueOn: z.string().regex(DAY_PATTERN).nullable().optional(),
  notes: z.string().max(MAX_NOTES_CHARS).nullable().optional(),
  helpers: z.array(z.string().trim().min(1)).max(MAX_HELPERS).optional(),
  addToToday: z.boolean().optional(),
});

function unauthorized() {
  return NextResponse.json({ error: "Send a valid API key as 'Authorization: Bearer <key>'" }, { status: 401 });
}

/** What a task can be given: the team (names and emails) and the task kinds. */
export async function GET(request: Request) {
  if (!(await authenticateApiKey(request))) return unauthorized();
  const members = await listTeamMembers();
  return NextResponse.json({
    team: members.map((m) => ({ name: m.name, email: m.email })),
    areas: TEAM_TASK_AREAS.map((a) => ({ key: a.key, label: a.label })),
    body: { title: "string", owner: "name or email", area: "area key or label", dueOn: "YYYY-MM-DD (optional)", notes: "optional", helpers: "names or emails (optional)", addToToday: "boolean (optional)" },
  });
}

/** Adds one Team Task, credited to the key's person. Owner and helpers are given by name or email. */
export async function POST(request: Request) {
  const caller = await authenticateApiKey(request);
  if (!caller) return unauthorized();

  const parsed = ExternalTaskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a title, an owner and an area. GET this URL for the options." }, { status: 400 });
  const input = parsed.data;

  const owner = await resolveTeamMember(input.owner);
  if (!owner) return NextResponse.json({ error: `No single team member matches "${input.owner}"` }, { status: 400 });
  const helperIds: string[] = [];
  for (const ref of input.helpers ?? []) {
    const helper = await resolveTeamMember(ref);
    if (!helper) return NextResponse.json({ error: `No single team member matches "${ref}"` }, { status: 400 });
    helperIds.push(helper.id);
  }
  const areaNeedle = input.area.toLowerCase();
  const area = TEAM_TASK_AREAS.find((a) => a.key === areaNeedle || a.label.toLowerCase() === areaNeedle)?.key ?? input.area;

  try {
    const id = await createTeamTask(
      { title: input.title, area, ownerId: owner.id, dueOn: input.dueOn ?? null, notes: input.notes ?? null, helperIds, addToToday: input.addToToday },
      teamDay(new Date()),
      caller.personnelId
    );
    return NextResponse.json({ id, owner: owner.name });
  } catch (error) {
    return teamTaskErrorResponse(error);
  }
}
