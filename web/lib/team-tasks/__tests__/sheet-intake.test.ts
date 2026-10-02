import assert from "node:assert";
import { eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamNotifications } from "@/lib/db/schema/team_notifications";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { setUpTaskSheet, syncTaskSheet, type SheetIo } from "../sheet-intake";

const TOOL_EMAIL = "test-sheet-tool@example.com";
const OWNER_EMAIL = "test-sheet-owner@example.com";
const EMAILS = [TOOL_EMAIL, OWNER_EMAIL];
const SETTING_KEYS = ["team_task_sheet", "team_task_sheet_last_sync"];

async function cleanup() {
  await db.delete(appSettings).where(inArray(appSettings.key, SETTING_KEYS));
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, EMAILS));
  const ids = people.map((p) => p.id);
  await db.delete(emailQueue).where(inArray(emailQueue.toEmail, EMAILS));
  if (ids.length === 0) return;
  const tasks = await db.select({ id: teamTasks.id }).from(teamTasks).where(inArray(teamTasks.ownerId, ids));
  if (tasks.length > 0) await db.delete(auditLog).where(inArray(auditLog.entityId, tasks.map((t) => t.id)));
  await db.delete(auditLog).where(or(inArray(auditLog.actorId, ids), inArray(auditLog.entityId, ids)));
  await db.delete(teamNotifications).where(or(inArray(teamNotifications.recipientId, ids), inArray(teamNotifications.actorId, ids)));
  await db.delete(teamTasks).where(inArray(teamTasks.ownerId, ids));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

async function testSheetRowsBecomeTasks() {
  console.log("Verifying sheet rows become tasks once, with errors written back...");
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Sheet Owner", email: OWNER_EMAIL, roles: ["full_time"] }).returning();
  const config = await setUpTaskSheet({ name: "Sheet Tool", email: TOOL_EMAIL }, null, async () => ({ id: "sheet-1", url: "https://docs.google.com/spreadsheets/d/sheet-1/edit" }));
  const [tool] = await db.select().from(personnel).where(eq(personnel.email, TOOL_EMAIL));
  assert.deepStrictEqual(tool.roles, [], "The tool can open no page");
  assert.strictEqual(config.actorId, tool.id);

  // A fake sheet: rows 2 onward, with the status column F written back.
  const rows: string[][] = [
    ["Draft the Diwali post", "Sheet Owner", "Marketing", "2032-03-15", "From the insight", ""],
    ["Bad area", "Sheet Owner", "nonsense", "", "", ""],
    ["Already done", "Sheet Owner", "ops", "", "", "Added earlier"],
    ["", "", "", "", "", ""],
  ];
  const io: SheetIo = {
    read: async () => rows.map((r) => [...r]),
    write: async (_id, cell, values) => {
      const index = Number(cell.slice(1)) - 2;
      rows[index][5] = values[0][0];
    },
  };

  const first = await syncTaskSheet({ io });
  assert.deepStrictEqual(first, { added: 1, errors: 1 });
  assert.match(rows[0][5], /^Added for Sheet Owner/);
  assert.match(rows[1][5], /^Error: area must be one of/);
  assert.strictEqual(rows[2][5], "Added earlier", "A row with a status is left alone");

  const tasks = await db.select().from(teamTasks).where(eq(teamTasks.ownerId, owner.id));
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].title, "Draft the Diwali post");
  assert.strictEqual(tasks[0].area, "marketing");
  assert.strictEqual(tasks[0].createdBy, tool.id, "The task is credited to the tool");

  assert.strictEqual(await syncTaskSheet({ io }), null, "A second read within a minute is skipped");
  const forced = await syncTaskSheet({ io, force: true });
  assert.deepStrictEqual(forced, { added: 0, errors: 0 }, "Rows with a status aren't added again");
  console.log("Confirmed the task sheet");
}

testSheetRowsBecomeTasks()
  .then(async () => {
    await cleanup();
    console.log("✓ All task sheet assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
