// The Artifacts tab of Instinct's task sheet (lib/team-tasks/sheet-intake.ts): each new row becomes
// a Registry artifact, checked against its type's form exactly like the New Artifact form
// (lib/knowledge/artifact-forms.ts), and credited to Instinct's personnel row.

import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import type { SheetIo, TaskSheetConfig } from "@/lib/team-tasks/sheet-intake";
import { formForPrefix, parseArtifactSubmission, TREND_BRIEF_PREFIX, type ArtifactFile } from "./artifact-forms";
import { activeArtifact, createKnowledgeArtifact, InvalidTrendLinkError } from "./artifacts-service";

export const ARTIFACTS_TAB = "Artifacts";
// One column per field any type can have. A type ignores the columns its form doesn't ask for.
export const ARTIFACT_SHEET_HEADER = [
  "type (INS, TR, MBD, RK, PRM, ANA, TG, CD, or the type's name)",
  "title",
  "description",
  "link",
  "usage notes",
  "trend (e.g. TR001, or the trend's name)",
  "category",
  "date seen (YYYY-MM-DD)",
  "season",
  "chat link",
  "files (one link per line; add ' | note' after a link to say what it is)",
  "status (filled in by the Kanban)",
];
const COLUMN = { type: 0, title: 1, description: 2, link: 3, usageNotes: 4, trend: 5, category: 6, seenOn: 7, season: 8, chatLink: 9, files: 10, status: 11 };
const STATUS_COLUMN_LETTER = "L";
const SHEET_RANGE = `${ARTIFACTS_TAB}!A2:L1000`;
const FIRST_DATA_ROW = 2;

// Each form field key and the sheet column its value comes from.
const FIELD_COLUMNS: Record<string, number> = {
  title: COLUMN.title,
  description: COLUMN.description,
  fileUrl: COLUMN.link,
  usageNotes: COLUMN.usageNotes,
  trendArtifactId: COLUMN.trend,
  category: COLUMN.category,
  seenOn: COLUMN.seenOn,
  season: COLUMN.season,
  chatLink: COLUMN.chatLink,
  attachments: COLUMN.files,
  inputs: COLUMN.files,
};

/** The links in a files cell, one per line, each optionally followed by " | note". */
function parseFiles(cell: string): ArtifactFile[] {
  return cell
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [url, ...note] = line.split("|").map((part) => part.trim());
      const name = decodeURIComponent(url.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "") || `File ${index + 1}`;
      return note.length > 0 && note.join(" | ") ? { url, name, note: note.join(" | ") } : { url, name };
    });
}

/** A Trend Brief's row id from its typed id (TR001) or its exact title, or null. */
async function findTrendBrief(ref: string): Promise<string | null> {
  const [trend] = await db
    .select({ id: knowledgeArtifacts.id })
    .from(knowledgeArtifacts)
    .innerJoin(artifactTypeConfig, eq(knowledgeArtifacts.artifactTypeId, artifactTypeConfig.id))
    .where(
      and(
        eq(artifactTypeConfig.prefix, TREND_BRIEF_PREFIX),
        activeArtifact(),
        or(ilike(knowledgeArtifacts.artifactId, ref), ilike(knowledgeArtifacts.title, ref))
      )
    )
    .limit(1);
  return trend?.id ?? null;
}

/** One row as a new artifact, or why it can't be one. */
async function rowToArtifact(row: string[]): Promise<{ error: string } | { typeId: string; values: Record<string, unknown> }> {
  const cell = (index: number) => (row[index] ?? "").trim();
  const typeRef = cell(COLUMN.type).toLowerCase();
  const types = await db.select().from(artifactTypeConfig).where(eq(artifactTypeConfig.isActive, true));
  const type = types.find((t) => t.prefix.toLowerCase() === typeRef || t.label.toLowerCase() === typeRef);
  if (!type) return { error: `type must be one of ${types.map((t) => t.prefix).join(", ")}` };

  const values: Record<string, unknown> = {};
  for (const field of formForPrefix(type.prefix).fields) {
    const column = FIELD_COLUMNS[field.key];
    if (column === undefined || !cell(column)) continue;
    if (field.kind === "files") values[field.key] = parseFiles(cell(column));
    else if (field.kind === "trend") {
      const trendId = await findTrendBrief(cell(column));
      if (!trendId) return { error: `No Trend Brief matches "${cell(column)}"` };
      values[field.key] = trendId;
    } else values[field.key] = cell(column);
  }
  return { typeId: type.id, values };
}

/**
 * Adds every new row of the Artifacts tab (a title and an empty status) to the Registry, and writes
 * "Added TR004" or the error in the row's status column.
 *
 * Input: the sheet's settings and its reader and writer. Output: how many were added and how many
 * had errors.
 */
export async function syncArtifactRows(config: TaskSheetConfig, io: SheetIo): Promise<{ added: number; errors: number }> {
  const rows = await io.read(config.sheetId, SHEET_RANGE);
  let added = 0;
  let errors = 0;
  for (const [index, row] of rows.entries()) {
    if ((row[COLUMN.status] ?? "").trim() || !(row[COLUMN.title] ?? "").trim()) continue;
    const cell = `${ARTIFACTS_TAB}!${STATUS_COLUMN_LETTER}${FIRST_DATA_ROW + index}`;
    const fail = async (message: string) => {
      await io.write(config.sheetId, cell, [[`Error: ${message}. Fix the row and clear this cell to retry.`]]);
      errors++;
    };

    const mapped = await rowToArtifact(row);
    if ("error" in mapped) {
      await fail(mapped.error);
      continue;
    }
    const type = await db.select({ prefix: artifactTypeConfig.prefix }).from(artifactTypeConfig).where(eq(artifactTypeConfig.id, mapped.typeId));
    const parsed = parseArtifactSubmission(formForPrefix(type[0].prefix), mapped.values);
    if (!parsed.ok) {
      await fail(parsed.error);
      continue;
    }
    // Written before the artifact is made, so a failure after this point can't add the row twice.
    await io.write(config.sheetId, cell, [["Adding…"]]);
    try {
      const artifact = await createKnowledgeArtifact({ artifactTypeId: mapped.typeId, ...parsed.submission, addedBy: config.actorId, actorId: config.actorId });
      await io.write(config.sheetId, cell, [[`Added ${artifact.artifactId}`]]);
      added++;
    } catch (error) {
      if (!(error instanceof InvalidTrendLinkError)) console.error("[task sheet] adding an artifact failed:", error);
      await fail(error instanceof InvalidTrendLinkError ? error.message : "The Kanban couldn't add it");
    }
  }
  return { added, errors };
}
