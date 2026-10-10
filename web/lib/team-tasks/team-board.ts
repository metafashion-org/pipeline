import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamTaskHelpers } from "@/lib/db/schema/team_task_helpers";
import { teamTaskSubtasks } from "@/lib/db/schema/team_task_subtasks";
import { teamTaskLinks } from "@/lib/db/schema/team_task_links";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { teamTaskDayPlans } from "@/lib/db/schema/team_task_day_plans";
import { personnel } from "@/lib/db/schema/personnel";
import { assets } from "@/lib/db/schema/assets";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { auditLog } from "@/lib/db/schema/audit_log";
import { activeArtifact } from "@/lib/knowledge/artifacts-service";
import { listTeamMembers, type TeamMember } from "./team-members";
import { TEAM_TASK_ENTITY, TeamTaskNotFoundError } from "./team-tasks-service";
import { addDays, DONE_STATUS, teamDay, teamDayBounds } from "./task-rules";

// Caps on what one read returns, so a search or a link picker stays small.
const SEARCH_RESULTS_MAX = 50;
const LINK_OPTIONS_PER_KIND = 8;
const HISTORY_ENTRIES_MAX = 50;
const DAYS_PER_WEEK = 7;

export interface BoardSubtask {
  id: string;
  title: string;
  ownerId: string | null;
  dueOn: string | null;
  doneAt: Date | null;
  position: number;
}

/**
 * The tasks a person may see: every shared task, and the private ones they own, made or help on.
 *
 * Input: the viewer's personnel id, or null for something everyone sees (the #office summary).
 * Output: a condition on team_tasks.
 */
export function visibleTo(viewerId: string | null): SQL {
  const shared = eq(teamTasks.isPrivate, false);
  if (!viewerId) return shared;
  return or(
    shared,
    eq(teamTasks.ownerId, viewerId),
    eq(teamTasks.createdBy, viewerId),
    sql`exists (select 1 from ${teamTaskHelpers} where ${teamTaskHelpers.taskId} = ${teamTasks.id} and ${teamTaskHelpers.personnelId} = ${viewerId})`
  ) as SQL;
}

export interface BoardTask {
  id: string;
  /** Only its owner, creator and helpers see it. */
  isPrivate: boolean;
  title: string;
  notes: string | null;
  area: string;
  status: string;
  waitingOn: string | null;
  ownerId: string;
  dueOn: string | null;
  position: number;
  targetCount: number | null;
  doneCount: number;
  focus: string | null;
  recurrenceId: string | null;
  occurrenceOn: string | null;
  createdAt: Date;
  completedAt: Date | null;
  lastActivityAt: Date;
  helperIds: string[];
  subtasks: BoardSubtask[];
  linkCount: number;
  commentCount: number;
  /** The newest comment: the owner's latest update, shown on the card. */
  latestUpdate: { body: string; authorName: string | null; createdAt: Date } | null;
}

export interface TeamBoard {
  today: string;
  /** The day the plans are for: today, or a later day someone is planning ahead. */
  planDay: string;
  members: TeamMember[];
  tasks: BoardTask[];
  /** The plans for planDay: each person's picks, in order. */
  plans: { personnelId: string; taskId: string; position: number }[];
}

// The helpers, subtasks, link and comment counts and latest update for a set of tasks.
async function decorateTasks(rows: (typeof teamTasks.$inferSelect)[]): Promise<BoardTask[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [helpers, subtasks, links, commentCounts, latestComments] = await Promise.all([
    db.select().from(teamTaskHelpers).where(inArray(teamTaskHelpers.taskId, ids)),
    db.select().from(teamTaskSubtasks).where(inArray(teamTaskSubtasks.taskId, ids)).orderBy(asc(teamTaskSubtasks.position)),
    db
      .select({ taskId: teamTaskLinks.taskId, linkedTaskId: teamTaskLinks.linkedTaskId })
      .from(teamTaskLinks)
      .where(or(inArray(teamTaskLinks.taskId, ids), inArray(teamTaskLinks.linkedTaskId, ids))),
    db
      .select({ taskId: teamTaskComments.taskId, total: count() })
      .from(teamTaskComments)
      .where(inArray(teamTaskComments.taskId, ids))
      .groupBy(teamTaskComments.taskId),
    db
      .selectDistinctOn([teamTaskComments.taskId], {
        taskId: teamTaskComments.taskId,
        body: teamTaskComments.body,
        authorName: personnel.name,
        createdAt: teamTaskComments.createdAt,
      })
      .from(teamTaskComments)
      .leftJoin(personnel, eq(personnel.id, teamTaskComments.authorId))
      .where(inArray(teamTaskComments.taskId, ids))
      .orderBy(teamTaskComments.taskId, desc(teamTaskComments.createdAt)),
  ]);

  const linkCount = new Map<string, number>();
  for (const link of links) {
    linkCount.set(link.taskId, (linkCount.get(link.taskId) ?? 0) + 1);
    if (link.linkedTaskId) linkCount.set(link.linkedTaskId, (linkCount.get(link.linkedTaskId) ?? 0) + 1);
  }
  const commentCount = new Map(commentCounts.map((c) => [c.taskId, c.total]));
  const latest = new Map(latestComments.map((c) => [c.taskId, { body: c.body, authorName: c.authorName, createdAt: c.createdAt }]));

  return rows.map((row) => ({
    id: row.id,
    isPrivate: row.isPrivate,
    title: row.title,
    notes: row.notes,
    area: row.area,
    status: row.status,
    waitingOn: row.waitingOn,
    ownerId: row.ownerId,
    dueOn: row.dueOn,
    position: row.position,
    targetCount: row.targetCount,
    doneCount: row.doneCount,
    focus: row.focus,
    recurrenceId: row.recurrenceId,
    occurrenceOn: row.occurrenceOn,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    lastActivityAt: row.lastActivityAt,
    helperIds: helpers.filter((h) => h.taskId === row.id).map((h) => h.personnelId),
    subtasks: subtasks
      .filter((s) => s.taskId === row.id)
      .map((s) => ({ id: s.id, title: s.title, ownerId: s.ownerId, dueOn: s.dueOn, doneAt: s.doneAt, position: s.position })),
    linkCount: linkCount.get(row.id) ?? 0,
    commentCount: commentCount.get(row.id) ?? 0,
    latestUpdate: latest.get(row.id) ?? null,
  }));
}

/**
 * Everything the Team Tasks board shows: the full-time team, every open task, the tasks finished
 * today, and the plans for one day (today unless someone is planning ahead). Tasks finished before
 * today are left off; search still finds them.
 *
 * Input: today's day, who is looking, and the day to show plans for. Output: the board.
 */
export async function getTeamBoard(today: string, viewerId: string | null, planDay: string = today): Promise<TeamBoard> {
  const { start } = teamDayBounds(today);
  const [members, rows, plans] = await Promise.all([
    listTeamMembers(),
    db
      .select()
      .from(teamTasks)
      .where(and(or(ne(teamTasks.status, DONE_STATUS), gte(teamTasks.completedAt, start)), visibleTo(viewerId)))
      .orderBy(asc(teamTasks.position), asc(teamTasks.createdAt)),
    db
      .select({ personnelId: teamTaskDayPlans.personnelId, taskId: teamTaskDayPlans.taskId, position: teamTaskDayPlans.position })
      .from(teamTaskDayPlans)
      .where(eq(teamTaskDayPlans.planOn, planDay))
      .orderBy(asc(teamTaskDayPlans.position)),
  ]);
  return { today, planDay, members, tasks: await decorateTasks(rows), plans };
}

export interface TeamTaskLinkView {
  id: string;
  kind: "task" | "asset" | "artifact";
  targetId: string;
  label: string;
  sublabel: string;
  /** Where the link opens in the app. */
  href: string;
}

export interface TeamTaskDetail {
  task: BoardTask & { ownerName: string; createdByName: string | null };
  links: TeamTaskLinkView[];
  comments: { id: string; body: string; authorId: string | null; authorName: string | null; mentionedIds: string[]; createdAt: Date }[];
  history: { id: string; action: string; actorName: string | null; payload: unknown; createdAt: Date }[];
  /** Who has this task in their plan for today. */
  plannedTodayBy: string[];
}

/**
 * One task in full: its checklist, links (resolved to titles), comments, the history of changes
 * to it from audit_log, and who has it in today's plan.
 *
 * Input: the task id and today's day. Output: the detail. Throws TeamTaskNotFoundError.
 */
export async function getTeamTaskDetail(taskId: string, today: string, viewerId: string | null): Promise<TeamTaskDetail> {
  const owner = alias(personnel, "owner");
  const creator = alias(personnel, "creator");
  const [row] = await db
    .select({ task: teamTasks, ownerName: owner.name, createdByName: creator.name })
    .from(teamTasks)
    .innerJoin(owner, eq(owner.id, teamTasks.ownerId))
    .leftJoin(creator, eq(creator.id, teamTasks.createdBy))
    .where(and(eq(teamTasks.id, taskId), visibleTo(viewerId)))
    .limit(1);
  // A private task someone else can't see reads as missing, so its title never leaks.
  if (!row) throw new TeamTaskNotFoundError("That task doesn't exist");

  const otherTask = alias(teamTasks, "other_task");
  const [[decorated], taskLinks, assetLinks, artifactLinks, comments, history, planned] = await Promise.all([
    decorateTasks([row.task]),
    db
      .select({
        id: teamTaskLinks.id,
        taskId: teamTaskLinks.taskId,
        linkedTaskId: teamTaskLinks.linkedTaskId,
        title: otherTask.title,
        status: otherTask.status,
        otherId: otherTask.id,
        otherPrivate: otherTask.isPrivate,
        otherOwnerId: otherTask.ownerId,
        otherCreatedBy: otherTask.createdBy,
      })
      .from(teamTaskLinks)
      .innerJoin(
        otherTask,
        or(
          and(eq(teamTaskLinks.taskId, taskId), eq(otherTask.id, teamTaskLinks.linkedTaskId)),
          and(eq(teamTaskLinks.linkedTaskId, taskId), eq(otherTask.id, teamTaskLinks.taskId))
        )
      ),
    db
      .select({ id: teamTaskLinks.id, assetId: assets.id, sku: assets.sku, itemName: assets.itemName, status: assets.currentStatus })
      .from(teamTaskLinks)
      .innerJoin(assets, eq(assets.id, teamTaskLinks.assetId))
      .where(eq(teamTaskLinks.taskId, taskId)),
    db
      .select({ id: teamTaskLinks.id, artifactRowId: knowledgeArtifacts.id, artifactId: knowledgeArtifacts.artifactId, title: knowledgeArtifacts.title, typeLabel: artifactTypeConfig.label })
      .from(teamTaskLinks)
      .innerJoin(knowledgeArtifacts, eq(knowledgeArtifacts.id, teamTaskLinks.artifactId))
      .innerJoin(artifactTypeConfig, eq(artifactTypeConfig.id, knowledgeArtifacts.artifactTypeId))
      .where(and(eq(teamTaskLinks.taskId, taskId), activeArtifact())),
    db
      .select({
        id: teamTaskComments.id,
        body: teamTaskComments.body,
        authorId: teamTaskComments.authorId,
        authorName: personnel.name,
        mentionedIds: teamTaskComments.mentionedIds,
        createdAt: teamTaskComments.createdAt,
      })
      .from(teamTaskComments)
      .leftJoin(personnel, eq(personnel.id, teamTaskComments.authorId))
      .where(eq(teamTaskComments.taskId, taskId))
      .orderBy(asc(teamTaskComments.createdAt)),
    db
      .select({ id: auditLog.id, action: auditLog.action, actorName: personnel.name, payload: auditLog.payload, createdAt: auditLog.createdAt })
      .from(auditLog)
      .leftJoin(personnel, eq(personnel.id, auditLog.actorId))
      .where(and(eq(auditLog.entityType, TEAM_TASK_ENTITY), eq(auditLog.entityId, taskId)))
      .orderBy(desc(auditLog.createdAt))
      .limit(HISTORY_ENTRIES_MAX),
    db
      .select({ personnelId: teamTaskDayPlans.personnelId })
      .from(teamTaskDayPlans)
      .where(and(eq(teamTaskDayPlans.taskId, taskId), eq(teamTaskDayPlans.planOn, today))),
  ]);

  const links: TeamTaskLinkView[] = [
    ...taskLinks
      // A linked private task shows only to its owner and creator.
      .filter((l) => !l.otherPrivate || l.otherOwnerId === viewerId || l.otherCreatedBy === viewerId)
      .map((l) => ({ id: l.id, kind: "task" as const, targetId: l.otherId, label: l.title, sublabel: l.status, href: `/team?task=${l.otherId}` })),
    ...assetLinks.map((l) => ({
      id: l.id,
      kind: "asset" as const,
      targetId: l.assetId,
      label: `${l.sku} · ${l.itemName}`,
      sublabel: l.status,
      href: `/admin/board?asset=${encodeURIComponent(l.sku)}`,
    })),
    ...artifactLinks.map((l) => ({
      id: l.id,
      kind: "artifact" as const,
      targetId: l.artifactRowId,
      label: `${l.artifactId} · ${l.title}`,
      sublabel: l.typeLabel,
      href: `/admin/knowledge?artifact=${l.artifactRowId}`,
    })),
  ];

  return {
    task: { ...decorated, ownerName: row.ownerName, createdByName: row.createdByName },
    links,
    comments,
    history,
    plannedTodayBy: planned.map((p) => p.personnelId),
  };
}

export interface TeamTaskSearchHit {
  id: string;
  title: string;
  status: string;
  area: string;
  ownerName: string;
  dueOn: string | null;
  completedAt: Date | null;
}

/**
 * Finds tasks, done ones included, whose title, notes or comments contain the text.
 *
 * Input: the text. Output: up to SEARCH_RESULTS_MAX tasks, most recently active first.
 */
export async function searchTeamTasks(query: string, viewerId: string | null): Promise<TeamTaskSearchHit[]> {
  const text = query.trim();
  if (!text) return [];
  const pattern = `%${text}%`;
  return db
    .select({
      id: teamTasks.id,
      title: teamTasks.title,
      status: teamTasks.status,
      area: teamTasks.area,
      ownerName: personnel.name,
      dueOn: teamTasks.dueOn,
      completedAt: teamTasks.completedAt,
    })
    .from(teamTasks)
    .innerJoin(personnel, eq(personnel.id, teamTasks.ownerId))
    .where(
      and(
        visibleTo(viewerId),
        or(
          ilike(teamTasks.title, pattern),
          ilike(teamTasks.notes, pattern),
          sql`exists (select 1 from ${teamTaskComments} where ${teamTaskComments.taskId} = ${teamTasks.id} and ${teamTaskComments.body} ilike ${pattern})`
        )
      )
    )
    .orderBy(desc(teamTasks.lastActivityAt))
    .limit(SEARCH_RESULTS_MAX);
}

export interface TeamWeekDay {
  day: string;
  /** What the person planned that day, in order, with where each task stands now. */
  planned: { taskId: string; title: string; status: string }[];
  /** What they finished that day. */
  done: { taskId: string; title: string }[];
  /** Counted work for that day, e.g. curated 38 of 45. */
  counted: { taskId: string; title: string; focus: string | null; doneCount: number; targetCount: number }[];
}

export interface TeamWeek {
  weekStart: string;
  days: string[];
  people: { member: TeamMember; days: TeamWeekDay[]; doneTotal: number }[];
}

/**
 * A week of the team's work: for each person and day, what they planned, what they finished, and
 * their counted work.
 *
 * Input: the week's Monday. Output: the week.
 */
export async function getTeamWeek(weekStart: string, viewerId: string | null): Promise<TeamWeek> {
  const days = Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDays(weekStart, i));
  const weekEnd = addDays(weekStart, DAYS_PER_WEEK);
  const { start } = teamDayBounds(weekStart);
  const { start: end } = teamDayBounds(weekEnd);

  const [members, done, plans, counted] = await Promise.all([
    listTeamMembers(),
    db
      .select({ taskId: teamTasks.id, title: teamTasks.title, ownerId: teamTasks.ownerId, completedAt: teamTasks.completedAt })
      .from(teamTasks)
      // Counted work is shown by its count on its own day, not as "finished" on the day it was closed.
      .where(and(eq(teamTasks.status, DONE_STATUS), isNull(teamTasks.targetCount), gte(teamTasks.completedAt, start), lt(teamTasks.completedAt, end), visibleTo(viewerId))),
    db
      .select({
        personnelId: teamTaskDayPlans.personnelId,
        planOn: teamTaskDayPlans.planOn,
        taskId: teamTasks.id,
        title: teamTasks.title,
        status: teamTasks.status,
      })
      .from(teamTaskDayPlans)
      .innerJoin(teamTasks, eq(teamTasks.id, teamTaskDayPlans.taskId))
      .where(and(gte(teamTaskDayPlans.planOn, weekStart), lt(teamTaskDayPlans.planOn, weekEnd), visibleTo(viewerId)))
      .orderBy(asc(teamTaskDayPlans.position)),
    db
      .select({
        taskId: teamTasks.id,
        title: teamTasks.title,
        ownerId: teamTasks.ownerId,
        occurrenceOn: teamTasks.occurrenceOn,
        focus: teamTasks.focus,
        doneCount: teamTasks.doneCount,
        targetCount: teamTasks.targetCount,
      })
      .from(teamTasks)
      .where(and(isNotNull(teamTasks.targetCount), gte(teamTasks.occurrenceOn, weekStart), lt(teamTasks.occurrenceOn, weekEnd), visibleTo(viewerId))),
  ]);

  const people = members.map((member) => {
    const memberDays = days.map((day) => ({
      day,
      planned: plans.filter((p) => p.personnelId === member.id && p.planOn === day).map(({ taskId, title, status }) => ({ taskId, title, status })),
      done: done.filter((d) => d.ownerId === member.id && d.completedAt && teamDay(d.completedAt) === day).map(({ taskId, title }) => ({ taskId, title })),
      counted: counted
        .filter((c) => c.ownerId === member.id && c.occurrenceOn === day)
        .map((c) => ({ taskId: c.taskId, title: c.title, focus: c.focus, doneCount: c.doneCount, targetCount: c.targetCount as number })),
    }));
    return { member, days: memberDays, doneTotal: memberDays.reduce((sum, d) => sum + d.done.length, 0) };
  });
  return { weekStart, days, people };
}

export interface TeamLinkOptions {
  tasks: { id: string; title: string; status: string }[];
  assets: { id: string; sku: string; itemName: string }[];
  artifacts: { id: string; artifactId: string; title: string; typeLabel: string }[];
}

/**
 * What a task can be linked to that matches the text: other tasks, assets by SKU or name, and
 * Registry artifacts by ID or title.
 *
 * Input: the text, and the task being linked from (left out of its own results). Output: up to
 * LINK_OPTIONS_PER_KIND of each.
 */
export async function findTeamLinkOptions(query: string, fromTaskId: string | null, viewerId: string | null): Promise<TeamLinkOptions> {
  const text = query.trim();
  if (!text) return { tasks: [], assets: [], artifacts: [] };
  const pattern = `%${text}%`;
  const [tasks, assetRows, artifacts] = await Promise.all([
    db
      .select({ id: teamTasks.id, title: teamTasks.title, status: teamTasks.status })
      .from(teamTasks)
      .where(and(ilike(teamTasks.title, pattern), fromTaskId ? ne(teamTasks.id, fromTaskId) : undefined, visibleTo(viewerId)))
      .orderBy(desc(teamTasks.lastActivityAt))
      .limit(LINK_OPTIONS_PER_KIND),
    db
      .select({ id: assets.id, sku: assets.sku, itemName: assets.itemName })
      .from(assets)
      .where(or(ilike(assets.sku, pattern), ilike(assets.itemName, pattern)))
      .orderBy(desc(assets.updatedAt))
      .limit(LINK_OPTIONS_PER_KIND),
    db
      .select({ id: knowledgeArtifacts.id, artifactId: knowledgeArtifacts.artifactId, title: knowledgeArtifacts.title, typeLabel: artifactTypeConfig.label })
      .from(knowledgeArtifacts)
      .innerJoin(artifactTypeConfig, eq(artifactTypeConfig.id, knowledgeArtifacts.artifactTypeId))
      .where(and(activeArtifact(), or(ilike(knowledgeArtifacts.artifactId, pattern), ilike(knowledgeArtifacts.title, pattern))))
      .orderBy(desc(knowledgeArtifacts.createdAt))
      .limit(LINK_OPTIONS_PER_KIND),
  ]);
  return { tasks, assets: assetRows, artifacts };
}

/** The Team Tasks linked to a Registry artifact, for its detail sheet. */
export async function listTasksLinkedToArtifact(artifactId: string, viewerId: string | null) {
  return db
    .select({ id: teamTasks.id, title: teamTasks.title, status: teamTasks.status, ownerName: personnel.name })
    .from(teamTaskLinks)
    .innerJoin(teamTasks, eq(teamTasks.id, teamTaskLinks.taskId))
    .innerJoin(personnel, eq(personnel.id, teamTasks.ownerId))
    .where(and(eq(teamTaskLinks.artifactId, artifactId), visibleTo(viewerId)))
    .orderBy(desc(teamTasks.createdAt));
}

export interface TaskCalendarEntry {
  /** "plan": on someone's plan that day. "due": the task's deadline. */
  kind: "plan" | "due";
  day: string;
  taskId: string;
  title: string;
  personnelId: string;
  done: boolean;
}

/**
 * The Team Tasks calendar for a range of days: every planned day of every task, and every due
 * date, so the plan (the day someone will work on it) and the deadline (the day it must be in by)
 * sit side by side without being mixed up. Private tasks show only to the people who can see them.
 *
 * Input: the first and last day, "YYYY-MM-DD", inclusive, and who is looking. Output: the entries.
 */
export async function getTaskCalendar(from: string, to: string, viewerId: string | null): Promise<TaskCalendarEntry[]> {
  const [plans, dues] = await Promise.all([
    db
      .select({ day: teamTaskDayPlans.planOn, taskId: teamTasks.id, title: teamTasks.title, personnelId: teamTaskDayPlans.personnelId, status: teamTasks.status })
      .from(teamTaskDayPlans)
      .innerJoin(teamTasks, eq(teamTasks.id, teamTaskDayPlans.taskId))
      .where(and(gte(teamTaskDayPlans.planOn, from), sql`${teamTaskDayPlans.planOn} <= ${to}`, visibleTo(viewerId)))
      .orderBy(asc(teamTaskDayPlans.position)),
    db
      .select({ day: teamTasks.dueOn, taskId: teamTasks.id, title: teamTasks.title, personnelId: teamTasks.ownerId, status: teamTasks.status })
      .from(teamTasks)
      .where(and(isNotNull(teamTasks.dueOn), gte(teamTasks.dueOn, from), sql`${teamTasks.dueOn} <= ${to}`, visibleTo(viewerId))),
  ]);
  return [
    ...plans.map((p) => ({ kind: "plan" as const, day: p.day, taskId: p.taskId, title: p.title, personnelId: p.personnelId, done: p.status === DONE_STATUS })),
    ...dues.map((d) => ({ kind: "due" as const, day: d.day as string, taskId: d.taskId, title: d.title, personnelId: d.personnelId, done: d.status === DONE_STATUS })),
  ];
}
