// Reads the linked reports for AI naming. Before an item is named, the Kanban opens each Google Doc
// linked to it (an artifact's file link, or a Docs link in its description), finds the lines most
// relevant to the item, and saves them as naming evidence ("ANA007 line 101: ..."). Claude then
// receives those lines with the item, and the word-by-word evidence check accepts names built from
// them.
//
// Access: the service account reads only files shared with it (Viewer is enough). Reports in
// Arjun's Drive must be shared with it, or sit in a folder shared with it. A file it can't open,
// and anything that isn't a Google Doc (a PDF, a folder), is skipped and counted.

import { createHash } from "node:crypto";
import { JWT } from "google-auth-library";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { nameEvidence } from "@/lib/db/schema/name_evidence";

const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";
// Read-only Drive access, on a token of its own so the uploads keep their narrower scope.
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const DOC_MIME = "application/vnd.google-apps.document";
// At most this many lines per report per item, each cut to MAX_LINE_CHARS: the cost cap.
const MAX_LINES_PER_REPORT = 15;
const MAX_LINE_CHARS = 300;
const MIN_KEYWORD_CHARS = 3;
export const REPORT_READER = "kanban-report-reader";
// Words too common in the reports to find an item by.
const COMMON = new Set("the and with for from item items roblox catalog christmas tactical accessory back front waist neck head face hat shoulder slot new fast durable".split(" "));

/** Input: a URL. Output: the Google Docs or Drive file id in it, or null. */
export function docIdFrom(url: string): string | null {
  return url.match(/\/document\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ?? url.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/)?.[1] ?? null;
}

/**
 * The lines of a report most relevant to an item: lines containing the most distinct keywords,
 * best first, then put back in document order. Line numbers are 1-based.
 *
 * Input: the report text and the item's keywords. Output: up to MAX_LINES_PER_REPORT lines.
 */
export function relevantLines(text: string, keywords: string[]): { line: number; text: string }[] {
  const keys = [...new Set(keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= MIN_KEYWORD_CHARS && !COMMON.has(k)))];
  if (keys.length === 0) return [];
  return text
    .split(/\r?\n/)
    .map((t, i) => ({ line: i + 1, text: t.trim(), hits: keys.filter((k) => t.toLowerCase().includes(k)).length }))
    .filter((l) => l.hits > 0 && l.text)
    .sort((a, b) => b.hits - a.hits || a.line - b.line)
    .slice(0, MAX_LINES_PER_REPORT)
    .sort((a, b) => a.line - b.line)
    .map(({ line, text: t }) => ({ line, text: t.slice(0, MAX_LINE_CHARS) }));
}

/** Reads one Google Doc's text. Swappable so tests don't call Google. */
export type DocReader = (fileId: string) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>;

let cachedAuth: JWT | null = null;
function getAuth(): JWT {
  if (cachedAuth) return cachedAuth;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON isn't set");
  const creds = JSON.parse(raw);
  cachedAuth = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
  return cachedAuth;
}

export const GOOGLE_DOC_READER: DocReader = async (fileId) => {
  try {
    const token = (await getAuth().getAccessToken()).token;
    const headers = { Authorization: `Bearer ${token}` };
    const meta = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?fields=mimeType&supportsAllDrives=true`, { headers });
    if (!meta.ok) return { ok: false, reason: meta.status === 404 ? "not shared with the Kanban" : `Drive answered ${meta.status}` };
    const { mimeType } = (await meta.json()) as { mimeType?: string };
    if (mimeType !== DOC_MIME) return { ok: false, reason: `not a Google Doc (${mimeType ?? "unknown"})` };
    const res = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(fileId)}/export?mimeType=text/plain`, { headers });
    if (!res.ok) return { ok: false, reason: `export failed (${res.status})` };
    return { ok: true, text: await res.text() };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "read failed" };
  }
};

export interface ReportReadResult {
  read: number;
  linesSaved: number;
  skipped: { sku: string; artifactId: string; reason: string }[];
}

/**
 * Reads the reports linked to the items about to be named and saves their relevant lines as
 * naming evidence. Each report is read once per run. Saving the same line again adds nothing.
 *
 * Input: (optional) SKUs, and (for tests) the doc reader. Output: what was read and skipped.
 */
export async function readLinkedReports(options: { onlySkus?: string[]; statuses: string[]; reader?: DocReader }): Promise<ReportReadResult> {
  const reader = options.reader ?? GOOGLE_DOC_READER;
  const rows = await db
    .select({ id: assets.id, sku: assets.sku, itemName: assets.itemName, category: assets.category, briefFields: assets.briefFields })
    .from(assets)
    .where(and(inArray(assets.currentStatus, options.statuses), isNull(assets.boardHiddenAt), isNull(assets.approvedName), ...(options.onlySkus ? [inArray(assets.sku, options.onlySkus)] : [])));
  const result: ReportReadResult = { read: 0, linesSaved: 0, skipped: [] };
  if (rows.length === 0) return result;
  const links = await db
    .select({ assetId: artifactSkuLinks.assetId, artifactId: knowledgeArtifacts.artifactId, fileUrl: knowledgeArtifacts.fileUrl, description: knowledgeArtifacts.description })
    .from(artifactSkuLinks)
    .innerJoin(knowledgeArtifacts, eq(knowledgeArtifacts.id, artifactSkuLinks.artifactId))
    .where(inArray(artifactSkuLinks.assetId, rows.map((r) => r.id)));
  const texts = new Map<string, Awaited<ReturnType<DocReader>>>();
  for (const row of rows) {
    // Keywords only find lines; the working title is never a word source for the name itself.
    const keywords = `${row.itemName} ${row.category ?? ""} ${row.briefFields?.trendReasoning ?? ""}`.replace(/https?:\/\/\S+/g, " ").split(/[^A-Za-z]+/);
    for (const link of links.filter((l) => l.assetId === row.id)) {
      const urls = [link.fileUrl ?? "", ...((link.description ?? "").match(/https?:\/\/docs\.google\.com\/document\/\S+/g) ?? [])].filter(Boolean);
      const docIds = [...new Set(urls.map(docIdFrom).filter((id): id is string => !!id))];
      if (docIds.length === 0) {
        if (urls.length) result.skipped.push({ sku: row.sku, artifactId: link.artifactId, reason: "link isn't a Google Doc or Drive file" });
        continue;
      }
      for (const docId of docIds) {
        if (!texts.has(docId)) {
          texts.set(docId, await reader(docId));
          if (texts.get(docId)!.ok) result.read++;
        }
        const doc = texts.get(docId)!;
        if (!doc.ok) {
          result.skipped.push({ sku: row.sku, artifactId: link.artifactId, reason: doc.reason });
          continue;
        }
        for (const l of relevantLines(doc.text, keywords)) {
          const inserted = await db
            .insert(nameEvidence)
            .values({
              assetId: row.id,
              kind: "report_line",
              sourceRef: link.artifactId,
              location: `line ${l.line}`,
              quote: l.text,
              supports: [],
              confidence: "high",
              limits: "Picked automatically by keyword from the linked report; read it in context before relying on it",
              enteredBy: REPORT_READER,
              rowHash: createHash("sha256").update(`report:${row.id}:${docId}:${l.line}:${l.text}`).digest("hex").slice(0, 32),
            })
            .onConflictDoNothing()
            .returning({ id: nameEvidence.id });
          result.linesSaved += inserted.length;
        }
      }
    }
  }
  return result;
}
