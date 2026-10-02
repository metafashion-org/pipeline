import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { authenticateApiKey } from "@/lib/api-keys/api-key-service";
import { createTeamTask } from "@/lib/team-tasks/team-tasks-service";
import { resolveTeamMember } from "@/lib/team-tasks/team-members";
import { TeamTaskInputError } from "@/lib/team-tasks/team-tasks-service";
import { TEAM_TASK_AREAS, teamDay } from "@/lib/team-tasks/task-rules";

export const dynamic = "force-dynamic";

// Adds a Team Task when the link is opened, for tools that can only use a browser (Instinct has no
// HTTP tool that sends headers or POST). Like the route beside it, it skips getAuthedUser(): the
// "key" query parameter is the API key made in Settings, and the key can only add Team Tasks.
//
// /api/external/team-tasks/add?key=mfk_...&title=...&owner=Jayesh&area=ops&dueOn=2026-10-10&notes=...&helpers=Arjun,Aarushi

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_CHARS = 300;
const MAX_NOTES_CHARS = 5_000;
// A browser may reload or reopen the link; the same task from the same key within this window is
// treated as the one already added rather than a second task.
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** A small page whose first line says what happened, so a browser-driving tool can read it. */
function page(status: number, heading: string, detail: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escapeHtml(heading)}</title></head><body style="font-family:system-ui;padding:24px"><h1 style="font-size:20px">${escapeHtml(heading)}</h1><p>${escapeHtml(detail)}</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const caller = await authenticateApiKey(request);
  if (!caller) return page(401, "NOT ADDED: wrong or revoked key", "Check the key in the link.");

  const params = new URL(request.url).searchParams;
  const title = (params.get("title") ?? "").trim();
  const ownerRef = (params.get("owner") ?? "").trim();
  const areaRef = (params.get("area") ?? "").trim().toLowerCase();
  const dueOn = (params.get("dueOn") ?? "").trim() || null;
  const notes = (params.get("notes") ?? "").trim() || null;
  const helperRefs = (params.get("helpers") ?? "").split(",").map((h) => h.trim()).filter(Boolean);

  if (!title || title.length > MAX_TITLE_CHARS) return page(400, "NOT ADDED: missing title", `Add title=... (up to ${MAX_TITLE_CHARS} characters).`);
  if (dueOn && !DAY_PATTERN.test(dueOn)) return page(400, "NOT ADDED: bad due date", "dueOn must look like 2026-10-10.");
  if (notes && notes.length > MAX_NOTES_CHARS) return page(400, "NOT ADDED: notes too long", `Keep notes under ${MAX_NOTES_CHARS} characters.`);
  const area = TEAM_TASK_AREAS.find((a) => a.key === areaRef || a.label.toLowerCase() === areaRef)?.key;
  if (!area) return page(400, "NOT ADDED: unknown area", `area must be one of: ${TEAM_TASK_AREAS.map((a) => a.key).join(", ")}.`);
  const owner = await resolveTeamMember(ownerRef);
  if (!owner) return page(400, "NOT ADDED: unknown owner", `No single team member matches "${ownerRef}". Open /api/external/team-tasks?key=... for the list.`);
  const helperIds: string[] = [];
  for (const ref of helperRefs) {
    const helper = await resolveTeamMember(ref);
    if (!helper) return page(400, "NOT ADDED: unknown helper", `No single team member matches "${ref}".`);
    helperIds.push(helper.id);
  }

  const [existing] = await db
    .select({ id: teamTasks.id })
    .from(teamTasks)
    .where(
      and(
        eq(teamTasks.createdBy, caller.personnelId),
        eq(teamTasks.ownerId, owner.id),
        sql`lower(${teamTasks.title}) = ${title.toLowerCase()}`,
        gte(teamTasks.createdAt, new Date(Date.now() - DUPLICATE_WINDOW_MS))
      )
    )
    .limit(1);
  if (existing) return page(200, `ALREADY ADDED: "${title}" for ${owner.name}`, "This task was added a few minutes ago, so it wasn't added again.");

  try {
    await createTeamTask({ title, area, ownerId: owner.id, dueOn, notes, helperIds }, teamDay(new Date()), caller.personnelId);
  } catch (error) {
    if (error instanceof TeamTaskInputError) return page(400, `NOT ADDED: ${error.message}`, "Fix the link and open it again.");
    throw error;
  }
  return page(200, `ADDED: "${title}" for ${owner.name}`, `Kind: ${area}${dueOn ? `. Due ${dueOn}` : ""}.`);
}
