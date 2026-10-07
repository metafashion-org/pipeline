import { and, eq, inArray, max, ne, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamTaskHelpers } from "@/lib/db/schema/team_task_helpers";
import { teamTaskSubtasks } from "@/lib/db/schema/team_task_subtasks";
import { teamTaskLinks } from "@/lib/db/schema/team_task_links";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { teamTaskDayPlans } from "@/lib/db/schema/team_task_day_plans";
import { assets } from "@/lib/db/schema/assets";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { auditLog } from "@/lib/db/schema/audit_log";
import { activeArtifact } from "@/lib/knowledge/artifacts-service";
import { listTeamMembers } from "./team-members";
import { notifyTeamMember, type TeamNoticeTask } from "./team-notifications";
import { BLOCKED_STATUS, DONE_STATUS, isTeamTaskArea, isTeamTaskStatus, type TeamTaskStatus } from "./task-rules";

// Every write here records itself in audit_log under this entity type, which is also where a
// task's history is read back from (lib/team-tasks/team-board.ts).
export const TEAM_TASK_ENTITY = "team_task";

/** The request can't be carried out as asked: an unknown person, area or status, or an empty title. */
export class TeamTaskInputError extends Error {}

/** No task, subtask or link with that id. */
export class TeamTaskNotFoundError extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function teamMemberIds(): Promise<Set<string>> {
  return new Set((await listTeamMembers()).map((m) => m.id));
}

function assertMember(ids: Set<string>, personId: string, what: string): void {
  if (!ids.has(personId)) throw new TeamTaskInputError(`${what} must be someone on the full-time team`);
}

async function logTaskEvent(tx: Tx, action: string, taskId: string, actorId: string | null, payload: Record<string, unknown>): Promise<void> {
  await tx.insert(auditLog).values({ action, entityType: TEAM_TASK_ENTITY, entityId: taskId, actorId, payload });
}

// The next free position at the bottom of an owner's open list.
async function nextQueuePosition(tx: Tx, ownerId: string): Promise<number> {
  const [row] = await tx
    .select({ top: max(teamTasks.position) })
    .from(teamTasks)
    .where(and(eq(teamTasks.ownerId, ownerId), ne(teamTasks.status, DONE_STATUS)));
  return (row?.top ?? -1) + 1;
}

// The next free position at the bottom of a person's plan for a day.
async function nextPlanPosition(tx: Tx, personnelId: string, planOn: string): Promise<number> {
  const [row] = await tx
    .select({ top: max(teamTaskDayPlans.position) })
    .from(teamTaskDayPlans)
    .where(and(eq(teamTaskDayPlans.personnelId, personnelId), eq(teamTaskDayPlans.planOn, planOn)));
  return (row?.top ?? -1) + 1;
}

/**
 * Puts a task at the bottom of a person's plan for a day, unless it's already in it.
 *
 * Input: the open transaction, the person, the task and the day. Output: nothing.
 */
export async function addToDayPlan(tx: Tx, personnelId: string, taskId: string, planOn: string): Promise<void> {
  const position = await nextPlanPosition(tx, personnelId, planOn);
  await tx.insert(teamTaskDayPlans).values({ planOn, personnelId, taskId, position }).onConflictDoNothing();
}

async function loadTask(taskId: string) {
  const [task] = await db.select().from(teamTasks).where(eq(teamTasks.id, taskId)).limit(1);
  if (!task) throw new TeamTaskNotFoundError("That task doesn't exist");
  return task;
}

function noticeTask(task: { id: string; title: string; area: string; status: string; dueOn: string | null }): TeamNoticeTask {
  return { id: task.id, title: task.title, area: task.area, status: task.status, dueOn: task.dueOn };
}

export interface NewTeamTaskInput {
  title: string;
  area: string;
  ownerId: string;
  dueOn?: string | null;
  notes?: string | null;
  helperIds?: string[];
  targetCount?: number | null;
  /** Puts it in the owner's plan for `today`. */
  addToToday?: boolean;
  /** Registry artifacts to link it to, e.g. the insight it came from. */
  artifactIds?: string[];
  /** Assets (by row id) to link it to. */
  assetIds?: string[];
  /** Only the owner, the creator and helpers see it. */
  isPrivate?: boolean;
}

/**
 * Makes a task at the bottom of the owner's list, with its helpers and first links, and tells the
 * owner when someone else gave it to them.
 *
 * Input: the task, today's day (for "add to today"), and who is making it. Output: the new task's id.
 * Throws TeamTaskInputError for an empty title, an unknown area, or an owner or helper who isn't on
 * the full-time team.
 */
export async function createTeamTask(input: NewTeamTaskInput, today: string, actorId: string | null): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new TeamTaskInputError("The task needs a title");
  if (!isTeamTaskArea(input.area)) throw new TeamTaskInputError("Pick what kind of task it is");
  const members = await teamMemberIds();
  assertMember(members, input.ownerId, "The owner");
  const helperIds = [...new Set(input.helperIds ?? [])].filter((id) => id !== input.ownerId);
  helperIds.forEach((id) => assertMember(members, id, "Each helper"));

  const task = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(teamTasks)
      .values({
        title,
        area: input.area,
        ownerId: input.ownerId,
        dueOn: input.dueOn || null,
        notes: input.notes?.trim() || null,
        targetCount: input.targetCount ?? null,
        position: await nextQueuePosition(tx, input.ownerId),
        createdBy: actorId,
        isPrivate: input.isPrivate ?? false,
      })
      .returning();
    if (helperIds.length > 0) {
      await tx.insert(teamTaskHelpers).values(helperIds.map((personnelId) => ({ taskId: created.id, personnelId })));
    }
    const links = [
      ...(input.artifactIds ?? []).map((artifactId) => ({ taskId: created.id, artifactId, createdBy: actorId })),
      ...(input.assetIds ?? []).map((assetId) => ({ taskId: created.id, assetId, createdBy: actorId })),
    ];
    if (links.length > 0) await tx.insert(teamTaskLinks).values(links).onConflictDoNothing();
    if (input.addToToday) await addToDayPlan(tx, input.ownerId, created.id, today);
    await logTaskEvent(tx, "createTeamTask", created.id, actorId, { title, ownerId: input.ownerId, area: input.area });
    return created;
  });

  await notifyTeamMember({ recipientId: task.ownerId, actorId, kind: "assigned", task: noticeTask(task) });
  return task.id;
}

export interface TeamTaskPatch {
  title?: string;
  notes?: string | null;
  area?: string;
  status?: string;
  waitingOn?: string | null;
  ownerId?: string;
  dueOn?: string | null;
  targetCount?: number | null;
  doneCount?: number;
  helperIds?: string[];
  isPrivate?: boolean;
}

/**
 * Changes a task and logs what changed. Marking it done stamps completedAt; reopening clears it.
 * Giving it to someone else moves it to the bottom of their list, out of the previous owner's plan
 * for today, and tells the new owner.
 *
 * Input: the task id, the changes, today's day, and who is making them. Output: nothing.
 * Throws TeamTaskNotFoundError or TeamTaskInputError.
 */
export async function updateTeamTask(taskId: string, patch: TeamTaskPatch, today: string, actorId: string | null): Promise<void> {
  const task = await loadTask(taskId);
  const now = new Date();
  const set: Partial<typeof teamTasks.$inferInsert> = { updatedAt: now, lastActivityAt: now };
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const note = (field: string, from: unknown, to: unknown) => {
    if (from !== to) changed[field] = { from, to };
  };

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new TeamTaskInputError("The task needs a title");
    set.title = title;
    note("title", task.title, title);
  }
  if (patch.notes !== undefined) {
    set.notes = patch.notes?.trim() || null;
    note("notes", task.notes, set.notes);
  }
  if (patch.area !== undefined) {
    if (!isTeamTaskArea(patch.area)) throw new TeamTaskInputError("Pick what kind of task it is");
    set.area = patch.area;
    note("area", task.area, patch.area);
  }
  let status = task.status as TeamTaskStatus;
  if (patch.status !== undefined) {
    if (!isTeamTaskStatus(patch.status)) throw new TeamTaskInputError("Unknown status");
    status = patch.status;
    set.status = status;
    if (status === DONE_STATUS && task.status !== DONE_STATUS) set.completedAt = now;
    if (status !== DONE_STATUS && task.status === DONE_STATUS) set.completedAt = null;
    note("status", task.status, status);
  }
  if (patch.waitingOn !== undefined) set.waitingOn = patch.waitingOn?.trim() || null;
  // "Waiting on" only means something while the task is blocked.
  if (status !== BLOCKED_STATUS) set.waitingOn = null;
  if (patch.dueOn !== undefined) {
    set.dueOn = patch.dueOn || null;
    note("dueOn", task.dueOn, set.dueOn);
  }
  if (patch.targetCount !== undefined) set.targetCount = patch.targetCount;
  if (patch.isPrivate !== undefined) {
    // Only the people who can see a private task decide whether it's private.
    if (actorId !== task.ownerId && actorId !== task.createdBy) throw new TeamTaskInputError("Only the owner or whoever made the task can change who sees it");
    set.isPrivate = patch.isPrivate;
    note("isPrivate", task.isPrivate, patch.isPrivate);
  }
  if (patch.doneCount !== undefined) {
    set.doneCount = Math.max(0, Math.floor(patch.doneCount));
    note("doneCount", task.doneCount, set.doneCount);
  }

  const members = patch.ownerId !== undefined || patch.helperIds !== undefined ? await teamMemberIds() : new Set<string>();
  const newOwner = patch.ownerId !== undefined && patch.ownerId !== task.ownerId ? patch.ownerId : null;
  if (newOwner) {
    assertMember(members, newOwner, "The owner");
    set.ownerId = newOwner;
    note("ownerId", task.ownerId, newOwner);
  }
  const ownerAfter = newOwner ?? task.ownerId;
  const helperIds = patch.helperIds === undefined ? null : [...new Set(patch.helperIds)].filter((id) => id !== ownerAfter);
  helperIds?.forEach((id) => assertMember(members, id, "Each helper"));

  await db.transaction(async (tx) => {
    if (newOwner) {
      set.position = await nextQueuePosition(tx, newOwner);
      await tx
        .delete(teamTaskDayPlans)
        .where(and(eq(teamTaskDayPlans.taskId, taskId), eq(teamTaskDayPlans.personnelId, task.ownerId), eq(teamTaskDayPlans.planOn, today)));
    }
    await tx.update(teamTasks).set(set).where(eq(teamTasks.id, taskId));
    if (helperIds) {
      await tx.delete(teamTaskHelpers).where(eq(teamTaskHelpers.taskId, taskId));
      if (helperIds.length > 0) await tx.insert(teamTaskHelpers).values(helperIds.map((personnelId) => ({ taskId, personnelId })));
      changed.helperIds = { from: null, to: helperIds };
    }
    await logTaskEvent(tx, "updateTeamTask", taskId, actorId, { changed });
  });

  if (newOwner) {
    await notifyTeamMember({ recipientId: newOwner, actorId, kind: "assigned", task: noticeTask({ ...task, ...set, id: taskId } as typeof task) });
  }
}

/**
 * Sets the order of a person's open tasks: the first id is the top of their list.
 *
 * Input: the owner, their open task ids in the new order, and who reordered them. Output: nothing.
 * Throws TeamTaskInputError when an id isn't one of that owner's open tasks.
 */
export async function reorderTeamQueue(ownerId: string, taskIds: string[], actorId: string | null): Promise<void> {
  if (taskIds.length === 0) return;
  const owned = await db
    .select({ id: teamTasks.id })
    .from(teamTasks)
    .where(and(eq(teamTasks.ownerId, ownerId), inArray(teamTasks.id, taskIds), ne(teamTasks.status, DONE_STATUS)));
  if (owned.length !== new Set(taskIds).size) throw new TeamTaskInputError("Those aren't all this person's open tasks");
  await db.transaction(async (tx) => {
    for (const [position, id] of taskIds.entries()) {
      await tx.update(teamTasks).set({ position }).where(eq(teamTasks.id, id));
    }
    await tx.insert(auditLog).values({ action: "reorderTeamQueue", entityType: TEAM_TASK_ENTITY, entityId: ownerId, actorId, payload: { taskIds } });
  });
}

/**
 * Replaces a person's plan for a day with these tasks, in this order. Past days' plans stay as
 * they were, so what came first on any day can be looked back on.
 *
 * Input: the person, the day, the task ids in order, and who set it. Output: nothing.
 * Throws TeamTaskInputError for an unknown task.
 */
export async function setTeamDayPlan(personnelId: string, planOn: string, taskIds: string[], actorId: string | null): Promise<void> {
  const unique = [...new Set(taskIds)];
  if (unique.length > 0) {
    const found = await db.select({ id: teamTasks.id }).from(teamTasks).where(inArray(teamTasks.id, unique));
    if (found.length !== unique.length) throw new TeamTaskInputError("One of those tasks doesn't exist");
  }
  await db.transaction(async (tx) => {
    await tx.delete(teamTaskDayPlans).where(and(eq(teamTaskDayPlans.personnelId, personnelId), eq(teamTaskDayPlans.planOn, planOn)));
    if (unique.length > 0) {
      await tx.insert(teamTaskDayPlans).values(unique.map((taskId, position) => ({ planOn, personnelId, taskId, position })));
    }
    await tx.insert(auditLog).values({
      action: "setTeamDayPlan",
      entityType: TEAM_TASK_ENTITY,
      entityId: personnelId,
      actorId,
      payload: { planOn, taskIds: unique },
    });
  });
}

// Anything done to a task's subtasks, links or comments counts as activity on the task.
async function touchTask(tx: Tx, taskId: string): Promise<void> {
  const now = new Date();
  await tx.update(teamTasks).set({ lastActivityAt: now, updatedAt: now }).where(eq(teamTasks.id, taskId));
}

export interface SubtaskInput {
  title: string;
  ownerId?: string | null;
  dueOn?: string | null;
}

/**
 * Adds a checklist item to a task. An item given to someone other than the task's owner shows in
 * their column, and they are told.
 *
 * Input: the task, the item, and who added it. Output: the new subtask's id.
 */
export async function addTeamSubtask(taskId: string, input: SubtaskInput, actorId: string | null): Promise<string> {
  const task = await loadTask(taskId);
  const title = input.title.trim();
  if (!title) throw new TeamTaskInputError("The subtask needs a title");
  if (input.ownerId) assertMember(await teamMemberIds(), input.ownerId, "The subtask's owner");

  const subtaskId = await db.transaction(async (tx) => {
    const [top] = await tx.select({ top: max(teamTaskSubtasks.position) }).from(teamTaskSubtasks).where(eq(teamTaskSubtasks.taskId, taskId));
    const [created] = await tx
      .insert(teamTaskSubtasks)
      .values({ taskId, title, ownerId: input.ownerId || null, dueOn: input.dueOn || null, position: (top?.top ?? -1) + 1, createdBy: actorId })
      .returning({ id: teamTaskSubtasks.id });
    await touchTask(tx, taskId);
    await logTaskEvent(tx, "addTeamSubtask", taskId, actorId, { subtaskId: created.id, title, ownerId: input.ownerId || null });
    return created.id;
  });

  if (input.ownerId && input.ownerId !== task.ownerId) {
    await notifyTeamMember({ recipientId: input.ownerId, actorId, kind: "assigned", task: noticeTask({ ...task, title: `${task.title}: ${title}` }) });
  }
  return subtaskId;
}

export interface SubtaskPatch {
  title?: string;
  ownerId?: string | null;
  dueOn?: string | null;
  done?: boolean;
}

/**
 * Changes a checklist item: its text, owner, due day, or whether it's done.
 *
 * Input: the subtask, the changes, and who made them. Output: nothing.
 */
export async function updateTeamSubtask(subtaskId: string, patch: SubtaskPatch, actorId: string | null): Promise<void> {
  const [subtask] = await db.select().from(teamTaskSubtasks).where(eq(teamTaskSubtasks.id, subtaskId)).limit(1);
  if (!subtask) throw new TeamTaskNotFoundError("That subtask doesn't exist");
  const set: Partial<typeof teamTaskSubtasks.$inferInsert> = {};
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new TeamTaskInputError("The subtask needs a title");
    set.title = patch.title.trim();
  }
  const newOwner = patch.ownerId !== undefined && patch.ownerId !== subtask.ownerId ? patch.ownerId : undefined;
  if (newOwner) assertMember(await teamMemberIds(), newOwner, "The subtask's owner");
  if (patch.ownerId !== undefined) set.ownerId = patch.ownerId || null;
  if (patch.dueOn !== undefined) set.dueOn = patch.dueOn || null;
  if (patch.done !== undefined) set.doneAt = patch.done ? new Date() : null;

  await db.transaction(async (tx) => {
    await tx.update(teamTaskSubtasks).set(set).where(eq(teamTaskSubtasks.id, subtaskId));
    await touchTask(tx, subtask.taskId);
    await logTaskEvent(tx, "updateTeamSubtask", subtask.taskId, actorId, { subtaskId, ...patch });
  });

  if (newOwner) {
    const task = await loadTask(subtask.taskId);
    if (newOwner !== task.ownerId) {
      await notifyTeamMember({
        recipientId: newOwner,
        actorId,
        kind: "assigned",
        task: noticeTask({ ...task, title: `${task.title}: ${set.title ?? subtask.title}` }),
      });
    }
  }
}

/** Removes a checklist item, and logs it on the task. */
export async function deleteTeamSubtask(subtaskId: string, actorId: string | null): Promise<void> {
  const [subtask] = await db.select().from(teamTaskSubtasks).where(eq(teamTaskSubtasks.id, subtaskId)).limit(1);
  if (!subtask) throw new TeamTaskNotFoundError("That subtask doesn't exist");
  await db.transaction(async (tx) => {
    await tx.delete(teamTaskSubtasks).where(eq(teamTaskSubtasks.id, subtaskId));
    await touchTask(tx, subtask.taskId);
    await logTaskEvent(tx, "deleteTeamSubtask", subtask.taskId, actorId, { subtaskId, title: subtask.title });
  });
}

export type TeamTaskLinkTarget = { kind: "task"; id: string } | { kind: "asset"; id: string } | { kind: "artifact"; id: string };

/**
 * Links a task to another task, an asset or a Registry artifact. A link that already exists, in
 * either direction for two tasks, is left as it is.
 *
 * Input: the task, what to link it to, and who linked it. Output: nothing.
 * Throws TeamTaskNotFoundError when either end doesn't exist, TeamTaskInputError for a task linked to itself.
 */
export async function addTeamTaskLink(taskId: string, target: TeamTaskLinkTarget, actorId: string | null): Promise<void> {
  await loadTask(taskId);
  if (target.kind === "task") {
    if (target.id === taskId) throw new TeamTaskInputError("A task can't be linked to itself");
    await loadTask(target.id);
    const [existing] = await db
      .select({ id: teamTaskLinks.id })
      .from(teamTaskLinks)
      .where(
        or(
          and(eq(teamTaskLinks.taskId, taskId), eq(teamTaskLinks.linkedTaskId, target.id)),
          and(eq(teamTaskLinks.taskId, target.id), eq(teamTaskLinks.linkedTaskId, taskId))
        )
      )
      .limit(1);
    if (existing) return;
  } else if (target.kind === "asset") {
    const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, target.id)).limit(1);
    if (!asset) throw new TeamTaskNotFoundError("That asset doesn't exist");
  } else {
    const [artifact] = await db
      .select({ id: knowledgeArtifacts.id })
      .from(knowledgeArtifacts)
      .where(and(eq(knowledgeArtifacts.id, target.id), activeArtifact()))
      .limit(1);
    if (!artifact) throw new TeamTaskNotFoundError("That Registry item doesn't exist");
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(teamTaskLinks)
      .values({
        taskId,
        linkedTaskId: target.kind === "task" ? target.id : null,
        assetId: target.kind === "asset" ? target.id : null,
        artifactId: target.kind === "artifact" ? target.id : null,
        createdBy: actorId,
      })
      .onConflictDoNothing();
    await touchTask(tx, taskId);
    await logTaskEvent(tx, "addTeamTaskLink", taskId, actorId, { target });
  });
}

/** Removes a link, and logs it on the task it was made from. */
export async function removeTeamTaskLink(linkId: string, actorId: string | null): Promise<void> {
  const [link] = await db.select().from(teamTaskLinks).where(eq(teamTaskLinks.id, linkId)).limit(1);
  if (!link) throw new TeamTaskNotFoundError("That link doesn't exist");
  await db.transaction(async (tx) => {
    await tx.delete(teamTaskLinks).where(eq(teamTaskLinks.id, linkId));
    await touchTask(tx, link.taskId);
    await logTaskEvent(tx, "removeTeamTaskLink", link.taskId, actorId, {
      linkedTaskId: link.linkedTaskId,
      assetId: link.assetId,
      artifactId: link.artifactId,
    });
  });
}

/**
 * Adds an update to a task and tells everyone @mentioned in it, by email, on Discord and on the page.
 *
 * Input: the task, the text, the ids of the people mentioned (picked in the page's @ list), and the
 * author. Output: the comment's id. Mentions of people not on the full-time team are dropped.
 */
export async function addTeamTaskComment(taskId: string, body: string, mentionedIds: string[], actorId: string | null): Promise<string> {
  const task = await loadTask(taskId);
  const text = body.trim();
  if (!text) throw new TeamTaskInputError("Write something first");
  const members = await teamMemberIds();
  const mentioned = [...new Set(mentionedIds)].filter((id) => members.has(id));

  const commentId = await db.transaction(async (tx) => {
    const [comment] = await tx
      .insert(teamTaskComments)
      .values({ taskId, authorId: actorId, body: text, mentionedIds: mentioned })
      .returning({ id: teamTaskComments.id });
    await touchTask(tx, taskId);
    await logTaskEvent(tx, "commentTeamTask", taskId, actorId, { commentId: comment.id, mentionedIds: mentioned });
    return comment.id;
  });

  for (const recipientId of mentioned) {
    await notifyTeamMember({ recipientId, actorId, kind: "mention", task: noticeTask(task), quote: text });
  }
  return commentId;
}
