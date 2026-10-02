import assert from "node:assert";
import { eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { apiKeys } from "@/lib/db/schema/api_keys";
import { auditLog } from "@/lib/db/schema/audit_log";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamNotifications } from "@/lib/db/schema/team_notifications";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { authenticateApiKey, createApiKey, revokeApiKey } from "../api-key-service";
import { resolveTeamMember } from "@/lib/team-tasks/team-members";
import { POST } from "@/app/api/external/team-tasks/route";

const TOOL_EMAIL = "test-apikey-tool@example.com";
const OWNER_EMAIL = "test-apikey-owner@example.com";
const EMAILS = [TOOL_EMAIL, OWNER_EMAIL];
const URL = "http://localhost/api/external/team-tasks";

async function cleanup() {
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, EMAILS));
  const ids = people.map((p) => p.id);
  await db.delete(emailQueue).where(inArray(emailQueue.toEmail, EMAILS));
  if (ids.length === 0) return;
  const tasks = await db.select({ id: teamTasks.id }).from(teamTasks).where(inArray(teamTasks.ownerId, ids));
  const keys = await db.select({ id: apiKeys.id }).from(apiKeys).where(inArray(apiKeys.personnelId, ids));
  const entityIds = [...tasks.map((t) => t.id), ...keys.map((k) => k.id)];
  if (entityIds.length > 0) await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds));
  await db.delete(auditLog).where(inArray(auditLog.actorId, ids));
  await db.delete(teamNotifications).where(or(inArray(teamNotifications.recipientId, ids), inArray(teamNotifications.actorId, ids)));
  await db.delete(teamTasks).where(inArray(teamTasks.ownerId, ids));
  await db.delete(apiKeys).where(inArray(apiKeys.personnelId, ids));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

function call(key: string | null, body: unknown) {
  return POST(new Request(URL, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) }));
}

async function testKeyAddsTask() {
  console.log("Verifying a key adds a Team Task by owner name, and stops working once revoked...");
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Apikey Owner", email: OWNER_EMAIL, roles: ["full_time"] }).returning();
  const { id: keyId, key } = await createApiKey({ name: "Test Tool", email: TOOL_EMAIL }, null);

  const [tool] = await db.select().from(personnel).where(eq(personnel.email, TOOL_EMAIL));
  assert.deepStrictEqual(tool.roles, [], "The tool's person has no roles, so it opens no page");
  const [stored] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId));
  assert.notStrictEqual(stored.keyHash, key, "Only the hash is stored");

  assert.strictEqual((await resolveTeamMember("apikey owner"))?.id, owner.id);
  assert.strictEqual((await call(null, {})).status, 401);
  assert.strictEqual((await call("mfk_wrong", { title: "x", owner: "Apikey Owner", area: "ops" })).status, 401);
  assert.strictEqual((await call(key, { title: "x", owner: "Nobody Here", area: "ops" })).status, 400);

  const res = await call(key, { title: "Follow up on the Christmas insight", owner: OWNER_EMAIL, area: "Marketing", dueOn: "2032-03-15" });
  assert.strictEqual(res.status, 200);
  const { id } = await res.json();
  const [task] = await db.select().from(teamTasks).where(eq(teamTasks.id, id));
  assert.strictEqual(task.ownerId, owner.id);
  assert.strictEqual(task.area, "marketing", "An area label is accepted");
  assert.strictEqual(task.createdBy, tool.id, "The task is credited to the tool");

  await revokeApiKey(keyId, null);
  assert.strictEqual(await authenticateApiKey(new Request(URL, { headers: { Authorization: `Bearer ${key}` } })), null);
  assert.strictEqual((await call(key, { title: "y", owner: OWNER_EMAIL, area: "ops" })).status, 401);
  console.log("Confirmed the API key flow");
}

testKeyAddsTask()
  .then(async () => {
    await cleanup();
    console.log("✓ All API key assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
