// Instinct (the AI assistant) adds Team Tasks by writing rows in a Google Sheet, because it can
// only use a browser, Gmail and Google Drive: it can't send API requests with a key. The Kanban
// makes the sheet (its Google service account can only open files it made), reads new rows, adds
// each as a task credited to Instinct's personnel row, and writes "Added" or the error back.

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { createSharedSheet, readSheetRows, writeSheetCells } from "@/lib/assets/drive-upload";
import { createTeamTask, TeamTaskInputError } from "./team-tasks-service";
import { resolveTeamMember } from "./team-members";
import { TEAM_TASK_AREAS, teamDay } from "./task-rules";
import { ARTIFACTS_TAB, ARTIFACT_SHEET_HEADER, syncArtifactRows } from "@/lib/knowledge/artifact-sheet-intake";

const SHEET_SETTING_KEY = "team_task_sheet";
const LAST_SYNC_SETTING_KEY = "team_task_sheet_last_sync";
// Opening the board reads the sheet at most this often, so a busy board doesn't call Google on
// every load and two loads at once don't add the same row twice.
const MIN_SYNC_GAP_MS = 60 * 1000;
export const TASK_SHEET_HEADER = ["title", "owner", "area", "dueOn", "notes", "status (filled in by the Kanban)"];
const TASKS_TAB = "Tasks";
// Rows 2 to 1000, columns A (title) to F (status).
const SHEET_RANGE = `${TASKS_TAB}!A2:F1000`;
const FIRST_DATA_ROW = 2;
const STATUS_COLUMN = "F";
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_CHARS = 300;
const SHEET_ENTITY = "team_task_sheet";

export interface TaskSheetConfig {
  sheetId: string;
  url: string;
  email: string;
  actorId: string;
}

/** The sheet's reads and writes, swappable so tests don't call Google. */
export interface SheetIo {
  read: (sheetId: string, range: string) => Promise<string[][]>;
  write: (sheetId: string, startCell: string, rows: string[][]) => Promise<void>;
}

const googleSheetIo: SheetIo = { read: readSheetRows, write: writeSheetCells };

/** The task sheet's settings, or null before it's set up. */
export async function getTaskSheetConfig(): Promise<TaskSheetConfig | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SHEET_SETTING_KEY)).limit(1);
  return (row?.value as TaskSheetConfig | undefined) ?? null;
}

/** When the sheet was last read, or null if never. */
export async function getLastTaskSheetSync(): Promise<Date | null> {
  const [row] = await db.select({ updatedAt: appSettings.updatedAt }).from(appSettings).where(eq(appSettings.key, LAST_SYNC_SETTING_KEY)).limit(1);
  return row?.updatedAt ?? null;
}

/**
 * Makes the task sheet and shares it with the tool's email. The tool gets a personnel row with no
 * roles (made here if the email is new), so its tasks are credited to it and it can open no page.
 *
 * Input: the tool's name and email, who is setting it up, and a sheet maker (Google's by default).
 * Output: the saved settings, with the sheet's link.
 */
export async function setUpTaskSheet(
  input: { name: string; email: string },
  actorId: string | null,
  makeSheet: (name: string, tabs: { title: string; header: string[] }[], email: string) => Promise<{ id: string; url: string }> = createSharedSheet
): Promise<TaskSheetConfig> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email.includes("@")) throw new TeamTaskInputError("Give the tool a name and an email");

  const [existing] = await db.select().from(personnel).where(sql`lower(${personnel.email}) = ${email}`).limit(1);
  const tool =
    existing ??
    (await db.insert(personnel).values({ name, email, roles: [], notes: "Outside tool that adds Team Tasks through the task sheet. Has no page access." }).returning())[0];

  const sheet = await makeSheet(
    `${name} → Team Tasks`,
    [
      { title: TASKS_TAB, header: TASK_SHEET_HEADER },
      { title: ARTIFACTS_TAB, header: ARTIFACT_SHEET_HEADER },
    ],
    email
  );
  const config: TaskSheetConfig = { sheetId: sheet.id, url: sheet.url, email, actorId: tool.id };
  await db
    .insert(appSettings)
    .values({ key: SHEET_SETTING_KEY, value: config, updatedBy: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: config, updatedBy: actorId, updatedAt: new Date() } });
  await db.insert(auditLog).values({ action: "setUpTaskSheet", entityType: SHEET_ENTITY, entityId: tool.id, actorId, payload: { sheetId: sheet.id, email } });
  return config;
}

// Claims the next read: true when no read ran in the last MIN_SYNC_GAP_MS. One statement, so two
// board loads at the same moment can't both win.
async function claimSyncSlot(force: boolean): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - (force ? 0 : MIN_SYNC_GAP_MS));
  const claimed = await db
    .insert(appSettings)
    .values({ key: LAST_SYNC_SETTING_KEY, value: now.toISOString(), updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: now.toISOString(), updatedAt: now }, setWhere: sql`${appSettings.updatedAt} <= ${cutoff.toISOString()}` })
    .returning({ key: appSettings.key });
  return claimed.length > 0;
}

/** Why a sheet row can't become a task, or the task's fields. */
async function parseRow(row: string[]): Promise<{ error: string } | { title: string; ownerId: string; ownerName: string; area: string; dueOn: string | null; notes: string | null }> {
  const [title = "", ownerRef = "", areaRef = "", dueOn = "", notes = ""] = row.map((cell) => (cell ?? "").trim());
  if (!title) return { error: "No title" };
  if (title.length > MAX_TITLE_CHARS) return { error: `Title is longer than ${MAX_TITLE_CHARS} characters` };
  const area = TEAM_TASK_AREAS.find((a) => a.key === areaRef.toLowerCase() || a.label.toLowerCase() === areaRef.toLowerCase())?.key;
  if (!area) return { error: `area must be one of ${TEAM_TASK_AREAS.map((a) => a.key).join(", ")}` };
  if (dueOn && !DAY_PATTERN.test(dueOn)) return { error: "dueOn must look like 2026-10-10" };
  const owner = await resolveTeamMember(ownerRef);
  if (!owner) return { error: `No single team member matches "${ownerRef}"` };
  return { title, ownerId: owner.id, ownerName: owner.name, area, dueOn: dueOn || null, notes: notes || null };
}

/**
 * Adds every new row of the task sheet's Tasks tab as a Team Task, and of its Artifacts tab as a
 * Registry artifact, writing the result in each row's status column.
 * A row is new when it has a title and an empty status. Runs at most once a minute unless forced.
 *
 * Input: whether to skip the once-a-minute limit, and the sheet reader and writer. Output: how many
 * rows were added and how many had errors; null when the sheet isn't set up or a read ran recently.
 */
export async function syncTaskSheet(
  options: { force?: boolean; io?: SheetIo } = {}
): Promise<{ added: number; errors: number; artifactsAdded: number; artifactErrors: number } | null> {
  const config = await getTaskSheetConfig();
  if (!config) return null;
  if (!(await claimSyncSlot(Boolean(options.force)))) return null;
  const io = options.io ?? googleSheetIo;

  const rows = await io.read(config.sheetId, SHEET_RANGE);
  let added = 0;
  let errors = 0;
  for (const [index, row] of rows.entries()) {
    const status = (row[5] ?? "").trim();
    if (status || !(row[0] ?? "").trim()) continue;
    const cell = `${TASKS_TAB}!${STATUS_COLUMN}${FIRST_DATA_ROW + index}`;
    const parsed = await parseRow(row);
    if ("error" in parsed) {
      await io.write(config.sheetId, cell, [[`Error: ${parsed.error}. Fix the row and clear this cell to retry.`]]);
      errors++;
      continue;
    }
    // Writes the status first, so a failure after this point can't add the same row twice.
    await io.write(config.sheetId, cell, [["Adding…"]]);
    try {
      await createTeamTask({ title: parsed.title, area: parsed.area, ownerId: parsed.ownerId, dueOn: parsed.dueOn, notes: parsed.notes }, teamDay(new Date()), config.actorId);
      await io.write(config.sheetId, cell, [[`Added for ${parsed.ownerName}, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`]]);
      added++;
    } catch (error) {
      const message = error instanceof TeamTaskInputError ? error.message : "The Kanban couldn't add it";
      await io.write(config.sheetId, cell, [[`Error: ${message}. Clear this cell to retry.`]]);
      if (!(error instanceof TeamTaskInputError)) console.error("[task sheet] adding a row failed:", error);
      errors++;
    }
  }
  const artifacts = await syncArtifactRows(config, io);
  return { added, errors, artifactsAdded: artifacts.added, artifactErrors: artifacts.errors };
}
