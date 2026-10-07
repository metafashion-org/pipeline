import assert from "node:assert";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamNotifications } from "@/lib/db/schema/team_notifications";
import { auditLog } from "@/lib/db/schema/audit_log";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { listTeamMembers } from "../team-members";
import {
  addTeamSubtask,
  addTeamTaskComment,
  addTeamTaskLink,
  createTeamTask,
  deleteTeamSubtask,
  removeTeamTaskLink,
  reorderTeamQueue,
  setTeamDayPlan,
  TeamTaskInputError,
  updateTeamSubtask,
  updateTeamTask,
  TeamTaskNotFoundError,
} from "../team-tasks-service";
import { getTeamBoard, getTeamTaskDetail, searchTeamTasks } from "../team-board";
import { createKnowledgeArtifact } from "@/lib/knowledge/artifacts-service";

const OWNER_EMAIL = "test-team-owner@example.com";
const HELPER_EMAIL = "test-team-helper@example.com";
const OUTSIDER_EMAIL = "test-team-outsider@example.com";
const EMAILS = [OWNER_EMAIL, HELPER_EMAIL, OUTSIDER_EMAIL];
const ARTIFACT_TITLE = "(TEST-TEAM-TASKS) Avatar looks insight";
const TODAY = "2026-10-05";

async function cleanup() {
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, EMAILS));
  const ids = people.map((p) => p.id);
  if (ids.length > 0) {
    const tasks = await db.select({ id: teamTasks.id }).from(teamTasks).where(inArray(teamTasks.ownerId, ids));
    if (tasks.length > 0) await db.delete(auditLog).where(inArray(auditLog.entityId, tasks.map((t) => t.id)));
    await db.delete(teamTasks).where(inArray(teamTasks.ownerId, ids));
    await db.delete(auditLog).where(inArray(auditLog.actorId, ids));
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
  }
  const artifacts = await db.select({ id: knowledgeArtifacts.id }).from(knowledgeArtifacts).where(eq(knowledgeArtifacts.title, ARTIFACT_TITLE));
  if (artifacts.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, artifacts.map((a) => a.id)));
    await db.delete(knowledgeArtifacts).where(eq(knowledgeArtifacts.title, ARTIFACT_TITLE));
  }
  await db.delete(emailQueue).where(inArray(emailQueue.toEmail, EMAILS));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

async function setup() {
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Team Owner", email: OWNER_EMAIL, roles: ["curator", "full_time"] }).returning();
  const [helper] = await db.insert(personnel).values({ name: "Team Helper", email: HELPER_EMAIL, roles: ["Full_Time", "operator"] }).returning();
  const [outsider] = await db.insert(personnel).values({ name: "Freelance Artist", email: OUTSIDER_EMAIL, roles: ["artist"] }).returning();
  return { owner, helper, outsider };
}

async function notificationsFor(personnelId: string) {
  return db.select().from(teamNotifications).where(eq(teamNotifications.recipientId, personnelId));
}

async function run() {
  const { owner, helper, outsider } = await setup();

  console.log("Verifying the team is the full_time role's Active people, and freelancers aren't on it...");
  const members = (await listTeamMembers()).map((m) => m.email);
  assert.ok(members.includes(OWNER_EMAIL) && members.includes(HELPER_EMAIL), "Both full-time people are on the team (role matched in any case)");
  assert.ok(!members.includes(OUTSIDER_EMAIL), "A freelance artist is not");

  console.log("Verifying a task given to someone else lands at the bottom of their list and tells them...");
  const first = await createTeamTask({ title: "Find people who make full outfits", area: "hiring", ownerId: owner.id }, TODAY, helper.id);
  const second = await createTeamTask({ title: "Introduce emissive maps", area: "production", ownerId: owner.id, addToToday: true }, TODAY, owner.id);
  const [firstRow] = await db.select().from(teamTasks).where(eq(teamTasks.id, first));
  const [secondRow] = await db.select().from(teamTasks).where(eq(teamTasks.id, second));
  assert.ok(secondRow.position > firstRow.position, "A new task goes to the bottom of the owner's list");
  const ownerNotices = await notificationsFor(owner.id);
  assert.strictEqual(ownerNotices.length, 1, "Only the task someone else gave them is notified, not their own");
  assert.strictEqual(ownerNotices[0].kind, "assigned");
  const [email] = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, OWNER_EMAIL));
  assert.ok(email?.bodyHtml.includes(`/team?task=${first}`), "The email links to the task");

  await assert.rejects(
    () => createTeamTask({ title: "Should fail", area: "ops", ownerId: outsider.id }, TODAY, owner.id),
    TeamTaskInputError,
    "A freelancer can't own a team task"
  );
  await assert.rejects(() => createTeamTask({ title: "Should fail", area: "nonsense", ownerId: owner.id }, TODAY, owner.id), TeamTaskInputError);

  console.log("Verifying the board, today's plan and reordering...");
  let board = await getTeamBoard(TODAY, null);
  assert.deepStrictEqual(
    board.plans.filter((p) => p.personnelId === owner.id).map((p) => p.taskId),
    [second],
    "Add to today puts the task in the owner's plan"
  );
  await setTeamDayPlan(owner.id, TODAY, [first, second], owner.id);
  await reorderTeamQueue(owner.id, [second, first], helper.id);
  board = await getTeamBoard(TODAY, null);
  assert.deepStrictEqual(board.plans.filter((p) => p.personnelId === owner.id).map((p) => p.taskId), [first, second], "The plan is replaced, in order");
  const ownerOpen = board.tasks.filter((t) => t.ownerId === owner.id).sort((a, b) => a.position - b.position);
  assert.deepStrictEqual(ownerOpen.map((t) => t.id), [second, first], "Reordering puts the first id at the top");
  await assert.rejects(() => reorderTeamQueue(helper.id, [first], owner.id), TeamTaskInputError, "Only the owner's own tasks can be reordered as theirs");

  console.log("Verifying status changes, helpers, and done tasks leaving the board...");
  await updateTeamTask(first, { status: "blocked", waitingOn: "Arjun's budget", helperIds: [helper.id, outsider.id].slice(0, 1) }, TODAY, owner.id);
  let detail = await getTeamTaskDetail(first, TODAY, null);
  assert.strictEqual(detail.task.waitingOn, "Arjun's budget");
  assert.deepStrictEqual(detail.task.helperIds, [helper.id]);
  await assert.rejects(() => updateTeamTask(first, { helperIds: [outsider.id] }, TODAY, owner.id), TeamTaskInputError, "A freelancer can't help on a team task");
  await updateTeamTask(first, { status: "done" }, TODAY, owner.id);
  const [doneRow] = await db.select().from(teamTasks).where(eq(teamTasks.id, first));
  assert.ok(doneRow.completedAt, "Done stamps completedAt");
  assert.strictEqual(doneRow.waitingOn, null, "Waiting-on is cleared once the task isn't blocked");
  const tomorrow = "2099-01-01";
  assert.ok(!(await getTeamBoard(tomorrow, null)).tasks.some((t) => t.id === first), "A task done before the board's day is off the board");
  await updateTeamTask(first, { status: "todo" }, TODAY, owner.id);
  const [reopened] = await db.select().from(teamTasks).where(eq(teamTasks.id, first));
  assert.strictEqual(reopened.completedAt, null, "Reopening clears completedAt");

  console.log("Verifying giving a task to someone else moves it and tells them...");
  await updateTeamTask(second, { ownerId: helper.id }, TODAY, owner.id);
  const helperNotices = await notificationsFor(helper.id);
  assert.ok(helperNotices.some((n) => n.kind === "assigned" && n.taskId === second), "The new owner is told");
  board = await getTeamBoard(TODAY, null);
  assert.ok(!board.plans.some((p) => p.personnelId === owner.id && p.taskId === second), "It leaves the old owner's plan for today");

  console.log("Verifying subtasks, links and comments with mentions...");
  const subtask = await addTeamSubtask(first, { title: "Shortlist 5 outfit makers", ownerId: helper.id }, owner.id);
  assert.ok((await notificationsFor(helper.id)).some((n) => n.message.includes("Shortlist 5 outfit makers")), "A subtask given to someone tells them");
  await updateTeamSubtask(subtask, { done: true }, helper.id);
  board = await getTeamBoard(TODAY, null);
  assert.ok(board.tasks.find((t) => t.id === first)?.subtasks[0].doneAt, "Ticking a subtask stamps doneAt");

  const [insightType] = await db.select({ id: artifactTypeConfig.id }).from(artifactTypeConfig).where(eq(artifactTypeConfig.prefix, "INS"));
  const insight = await createKnowledgeArtifact({ artifactTypeId: insightType.id, title: ARTIFACT_TITLE, description: "Avatar looks can be published from Studio." });
  await addTeamTaskLink(first, { kind: "artifact", id: insight.id }, owner.id);
  await addTeamTaskLink(first, { kind: "task", id: second }, owner.id);
  await addTeamTaskLink(second, { kind: "task", id: first }, owner.id);
  detail = await getTeamTaskDetail(second, TODAY, null);
  assert.strictEqual(detail.links.filter((l) => l.kind === "task").length, 1, "A task link shows on both tasks, once");
  detail = await getTeamTaskDetail(first, TODAY, null);
  const insightLink = detail.links.find((l) => l.kind === "artifact");
  assert.ok(insightLink?.label.includes(ARTIFACT_TITLE), "The Registry link shows the artifact's title");
  await assert.rejects(() => addTeamTaskLink(first, { kind: "task", id: first }, owner.id), TeamTaskInputError);
  await removeTeamTaskLink(insightLink!.id, owner.id);

  await addTeamTaskComment(first, "@Team Helper can you check the rates? @Freelance Artist too", [helper.id, outsider.id], owner.id);
  assert.ok((await notificationsFor(helper.id)).some((n) => n.kind === "mention"), "A mentioned teammate is notified");
  assert.strictEqual((await notificationsFor(outsider.id)).length, 0, "A mention of someone outside the team is dropped");
  detail = await getTeamTaskDetail(first, TODAY, null);
  assert.deepStrictEqual(detail.comments[0].mentionedIds, [helper.id]);
  assert.strictEqual(detail.task.latestUpdate?.body.startsWith("@Team Helper"), true, "The newest comment is the card's latest update");
  await deleteTeamSubtask(subtask, owner.id);

  console.log("Verifying history and search...");
  const actions = detail.history.map((h) => h.action);
  for (const action of ["createTeamTask", "updateTeamTask", "addTeamSubtask", "addTeamTaskLink", "removeTeamTaskLink", "commentTeamTask"]) {
    assert.ok(actions.includes(action), `The task's history records ${action}`);
  }
  await updateTeamTask(first, { status: "done" }, TODAY, owner.id);
  const hits = await searchTeamTasks("check the rates", null);
  assert.ok(hits.some((h) => h.id === first && h.status === "done"), "Search finds a done task by its comment text");

  const logged = await db.select().from(auditLog).where(and(eq(auditLog.entityType, "team_task"), eq(auditLog.entityId, owner.id)));
  assert.ok(logged.some((l) => l.action === "setTeamDayPlan"), "Setting a plan is logged");

  console.log("Verifying a private task is seen only by its owner, its maker and its helpers...");
  const secret = await createTeamTask({ title: "Private salary review", area: "ops", ownerId: owner.id, isPrivate: true }, TODAY, owner.id);
  const seesSecret = async (viewerId: string | null) => (await getTeamBoard(TODAY, viewerId)).tasks.some((t) => t.id === secret);
  assert.ok(await seesSecret(owner.id), "Its owner sees it on the board");
  assert.ok(!(await seesSecret(helper.id)), "A teammate doesn't");
  assert.ok(!(await seesSecret(null)), "The #office summary doesn't");
  await assert.rejects(() => getTeamTaskDetail(secret, TODAY, helper.id), TeamTaskNotFoundError, "Opening it by link reads as missing");
  assert.strictEqual((await searchTeamTasks("salary review", helper.id)).length, 0, "Search hides it from a teammate");
  assert.strictEqual((await searchTeamTasks("salary review", owner.id)).length, 1, "Search finds it for its owner");
  await assert.rejects(() => updateTeamTask(secret, { isPrivate: false }, TODAY, helper.id), TeamTaskInputError, "Only its owner or maker changes who sees it");
  await updateTeamTask(secret, { helperIds: [helper.id] }, TODAY, owner.id);
  assert.ok(await seesSecret(helper.id), "A helper on it sees it");
  await updateTeamTask(secret, { isPrivate: false }, TODAY, owner.id);
  assert.ok(await seesSecret(null), "Made shared, everyone sees it");
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All Team Tasks assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
