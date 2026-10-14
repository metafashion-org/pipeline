// Naming evidence for Today's Picks (table name_evidence). Each record says which words of a final
// name one source supports: a report line, a workbook row, what an actual concept or listing image
// shows, or live Roblox metadata. It carries the exact location and text, a confidence, the
// record's limits (e.g. "product-family match; not proof of historical origin") and any conflict.
//
// Naming evidence is not design origin. artifact_sku_links records where a design came from and is
// never read or changed here; a SKU with no origin links can still have its name grounded in
// evidence. Records come in through the private sheet's Evidence tab, written by the work account
// that can open the sources, and are never deleted: a wrong record is retired with a reason.

import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { nameEvidence } from "@/lib/db/schema/name_evidence";
import { auditLog } from "@/lib/db/schema/audit_log";

export class NameEvidenceError extends Error {}

export const EVIDENCE_KINDS = ["report_line", "workbook_row", "image_correspondence", "live_metadata"] as const;
export const EVIDENCE_CONFIDENCE = ["high", "medium", "low"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

// Limits on what one sheet row may hold, so a pasted document can't stand in for a quoted location.
const MAX_QUOTE_CHARS = 1000;
const MAX_LOCATION_CHARS = 200;
const MAX_SOURCE_CHARS = 300;
const MAX_NOTE_CHARS = 500;
const MAX_SUPPORTED_WORDS = 20;
const MIN_RETIRE_REASON_CHARS = 10;

export interface NameEvidenceView {
  id: string;
  kind: EvidenceKind;
  sourceRef: string;
  location: string;
  quote: string;
  supports: string[];
  confidence: (typeof EVIDENCE_CONFIDENCE)[number];
  limits: string | null;
  conflict: string | null;
  enteredBy: string | null;
}

/** A short label for one record, e.g. "ANA007 line 101". */
export function evidenceLabel(e: Pick<NameEvidenceView, "sourceRef" | "location">): string {
  return `${e.sourceRef} ${e.location}`;
}

/** Input: asset ids. Output: each asset's active (not retired) naming evidence, oldest first. */
export async function loadNameEvidence(assetIds: string[]): Promise<Map<string, NameEvidenceView[]>> {
  const out = new Map<string, NameEvidenceView[]>();
  if (assetIds.length === 0) return out;
  const rows = await db
    .select()
    .from(nameEvidence)
    .where(and(inArray(nameEvidence.assetId, assetIds), isNull(nameEvidence.retiredAt)))
    .orderBy(nameEvidence.createdAt);
  for (const r of rows) {
    const list = out.get(r.assetId) ?? [];
    list.push({
      id: r.id,
      kind: r.kind as EvidenceKind,
      sourceRef: r.sourceRef,
      location: r.location,
      quote: r.quote,
      supports: r.supports,
      confidence: r.confidence as NameEvidenceView["confidence"],
      limits: r.limits,
      conflict: r.conflict,
      enteredBy: r.enteredBy,
    });
    out.set(r.assetId, list);
  }
  return out;
}

export interface EvidenceRow {
  sku: string;
  kind: string;
  sourceRef: string;
  location: string;
  quote: string;
  supports: string;
  confidence: string;
  limits: string;
  conflict: string;
  enteredBy: string;
}

/**
 * Stores new rows from the sheet's Evidence tab. A row is refused (and reported by sheet row) when
 * its SKU isn't live, its kind or confidence isn't a known value, it has no source, location or
 * quote, or a field is too long. Re-reading a row stores nothing new.
 *
 * Input: the rows and the live SKUs. Output: how many were new, already known, and refused.
 */
export async function ingestEvidenceRows(rows: EvidenceRow[], liveSkus: string[]): Promise<{ added: number; known: number; refused: { row: number; reason: string }[] }> {
  const skuAssets = await db.select({ id: assets.id, sku: assets.sku }).from(assets).where(inArray(assets.sku, liveSkus.concat(["-"])));
  const assetBySku = new Map(skuAssets.map((a) => [a.sku, a.id]));
  const result = { added: 0, known: 0, refused: [] as { row: number; reason: string }[] };
  for (const [index, raw] of rows.entries()) {
    const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (v ?? "").trim()])) as unknown as EvidenceRow;
    const supports = row.supports
      .split(/[,;]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const assetId = assetBySku.get(row.sku);
    let reason: string | null = null;
    if (!assetId || !liveSkus.includes(row.sku)) reason = `SKU "${row.sku}" isn't live`;
    else if (!EVIDENCE_KINDS.includes(row.kind as EvidenceKind)) reason = `kind must be one of ${EVIDENCE_KINDS.join(", ")}`;
    else if (!EVIDENCE_CONFIDENCE.includes(row.confidence as NameEvidenceView["confidence"])) reason = `confidence must be one of ${EVIDENCE_CONFIDENCE.join(", ")}`;
    else if (!row.sourceRef || row.sourceRef.length > MAX_SOURCE_CHARS) reason = "source_ref is required (at most 300 characters)";
    else if (!row.location || row.location.length > MAX_LOCATION_CHARS) reason = "location is required, e.g. 'line 101' or 'row 6' (at most 200 characters)";
    else if (!row.quote || row.quote.length > MAX_QUOTE_CHARS) reason = `quote is required: the exact text, or what the image shows (at most ${MAX_QUOTE_CHARS} characters)`;
    else if (supports.length > MAX_SUPPORTED_WORDS) reason = `supports lists at most ${MAX_SUPPORTED_WORDS} words`;
    else if (row.limits.length > MAX_NOTE_CHARS || row.conflict.length > MAX_NOTE_CHARS) reason = "limits and conflict hold at most 500 characters each";
    if (reason) {
      result.refused.push({ row: index + 2, reason });
      continue;
    }
    const rowHash = createHash("sha256")
      .update(JSON.stringify([row.sku, row.kind, row.sourceRef, row.location, row.quote, supports, row.confidence, row.limits, row.conflict]))
      .digest("hex")
      .slice(0, 32);
    const inserted = await db
      .insert(nameEvidence)
      .values({
        assetId: assetId!,
        kind: row.kind,
        sourceRef: row.sourceRef,
        location: row.location,
        quote: row.quote,
        supports,
        confidence: row.confidence,
        limits: row.limits || null,
        conflict: row.conflict || null,
        enteredBy: row.enteredBy || null,
        rowHash,
      })
      .onConflictDoNothing()
      .returning({ id: nameEvidence.id });
    if (inserted.length) result.added++;
    else result.known++;
  }
  return result;
}

/**
 * Retires a naming evidence record so it stops supporting names. The row and its reason stay.
 *
 * Input: the SKU, the record id, why, who. Output: nothing. Throws when the record isn't the SKU's.
 */
export async function retireEvidence(sku: string, evidenceId: string, reason: string, actorId: string | null): Promise<void> {
  if (reason.trim().length < MIN_RETIRE_REASON_CHARS) throw new NameEvidenceError("Say why this evidence is wrong");
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
  if (!asset) throw new NameEvidenceError(`Asset '${sku}' not found`);
  const updated = await db
    .update(nameEvidence)
    .set({ retiredAt: new Date(), retiredReason: reason.trim() })
    .where(and(eq(nameEvidence.id, evidenceId), eq(nameEvidence.assetId, asset.id), isNull(nameEvidence.retiredAt)))
    .returning({ id: nameEvidence.id });
  if (updated.length === 0) throw new NameEvidenceError("That evidence isn't this SKU's, or is already retired");
  await db.insert(auditLog).values({ action: "retireNameEvidence", entityType: "asset", entityId: asset.id, actorId, payload: { sku, evidenceId, reason: reason.trim() } });
}
