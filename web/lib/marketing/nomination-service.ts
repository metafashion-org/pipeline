// Today's Picks nomination drafts (stages 2 and 3). For each live SKU the Kanban suggests form
// answers from the SKU's own data, shows the evidence behind them, and checks them against the
// form's limits. Arjun edits them, approves the final name and the colour links explicitly, files
// the nomination himself on Roblox's form, then confirms here that he filed it. Nothing here
// submits anything to Roblox, renames a listing, or verifies a filing with Roblox: a recorded
// filing is Arjun's own confirmation.
//
// Final names: the internal item name is exploratory, so it is never turned into a final name. A
// name is checked word by word against the SKU's full evidence: its naming evidence records (exact
// report lines, workbook rows, image correspondences, live metadata; lib/marketing/name-evidence.ts),
// its linked artifacts and its trend origin. Naming evidence doesn't need a design-origin link. A
// word backed only by evidence marked as conflicting is refused, so conflicting designs aren't
// blended. Without any evidence a name can be typed but not approved.
//
// The form's fields and limits are in nomination-fields.ts.

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { nominationDrafts, nominationEvents, type NominationApprovals } from "@/lib/db/schema/nomination_drafts";
import { marketingSuggestions } from "@/lib/db/schema/marketing_suggestions";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { auditLog } from "@/lib/db/schema/audit_log";
import { parseRobloxCatalogLink } from "@/lib/publisher/roblox-links";
import { isPlaceholderName, listTodaysPicksPreview, TodaysPicksError, type PreviewItem, type PreviewListing } from "./todays-picks-service";
import { AUDIENCES, DRAFT_FIELDS, FIELD_LIMITS, FORM_VERSION, ITEM_TYPES, MAX_FINAL_NAME_CHARS, type DraftField, type DraftFields } from "./nomination-fields";
import { evidenceLabel, type NameEvidenceView } from "./name-evidence";

export { DRAFT_FIELDS, FORM_VERSION };

// Owner details for the form, settled by Arjun. Shown for copying; never sent anywhere by the Kanban.
export const NOMINATION_USERNAME = "goatgoelrblx";
export const NOMINATION_EMAIL = "arjun@metafashion.in";
// The private "Marketing company function" task. Confirmations and corrections are posted there as
// plain comments with no @mentions, so its audience stays the task's owner, creator and helpers.
export const MARKETING_TASK_ID = "5749e9a7-f86f-4035-a5fd-1b82e7312b2a";
// Fields a sheet suggestion may target. item_link and colour_links come only from the Kanban's own listings.
export const SUGGESTIBLE_FIELDS: DraftField[] = ["final_name", "item_type", "tags", "audience", "season", "extra_info", "theme"];
// Fields Arjun approves separately from saving: a generated value is never treated as approved.
export const APPROVABLE_FIELDS = ["final_name", "colour_links", "answers"] as const;
// The item-page answers approved together as "answers". item_link is included: choosing a main
// listing later changes it, and changed content needs a new review.
const ANSWER_FIELDS: DraftField[] = ["item_link", "item_type", "tags", "audience", "season", "extra_info", "theme"];
const MAX_REVIEW_REF_CHARS = 200;
export type ApprovableField = (typeof APPROVABLE_FIELDS)[number];
const MIN_UNDO_REASON_CHARS = 10;
// Evidence words offered for a name: the strongest few, so the list stays readable.
const MAX_NAME_TERMS = 15;
const MIN_TERM_CHARS = 3;
// Postgres unique_violation.
const UNIQUE_VIOLATION = "23505";

// Roblox AssetTypeId to the form's item type. Ids from Roblox's AssetType enum.
const ASSET_TYPE_TO_ITEM_TYPE: Record<number, (typeof ITEM_TYPES)[number]> = {
  8: "Accessory / Hair", 41: "Accessory / Hair", 42: "Accessory / Hair", 43: "Accessory / Hair", 44: "Accessory / Hair", 45: "Accessory / Hair", 46: "Accessory / Hair", 47: "Accessory / Hair",
  2: "Clothing / Shoes", 11: "Clothing / Shoes", 12: "Clothing / Shoes", 64: "Clothing / Shoes", 65: "Clothing / Shoes", 66: "Clothing / Shoes", 67: "Clothing / Shoes", 68: "Clothing / Shoes", 69: "Clothing / Shoes", 70: "Clothing / Shoes", 71: "Clothing / Shoes", 72: "Clothing / Shoes",
  27: "Character / Body", 28: "Character / Body", 29: "Character / Body", 30: "Character / Body", 31: "Character / Body",
  17: "Head", 79: "Head",
  61: "Emote",
};
// Roblox's own accessory type for each AssetTypeId, shown beside the form's combined category.
const ROBLOX_ACCESSORY_TYPE: Record<number, string> = { 8: "Hat accessory", 41: "Hair accessory", 42: "Face accessory", 43: "Neck accessory", 44: "Shoulder accessory", 45: "Front accessory", 46: "Back accessory", 47: "Waist accessory" };
// Roblox's accessory slot names, used as a discovery tag.
const ASSET_TYPE_SLOT: Record<number, string> = { 8: "hat", 41: "hair", 42: "face", 43: "neck", 44: "shoulder", 45: "front", 46: "back", 47: "waist" };
const SEASON_WORDS: [RegExp, string][] = [
  [/christmas|xmas|santa|reindeer|snowman|candy cane/i, "Christmas"],
  [/halloween|spooky|pumpkin/i, "Halloween"],
  [/valentine/i, "Valentine's Day"],
  [/easter/i, "Easter"],
  [/lunar new year/i, "Lunar New Year"],
];
// Words that carry no meaning in a name or a tag list, plus words common in trend notes and links.
const STOP_WORDS = new Set(
  "with and the a an of for in on w to from by is are was were be has have had it its this that these those our your their at as or but not new item items theme roblox catalog https http www com pin pinterest links link people among recent recently grown popularity subtask list scan oct snapshot".split(" ")
);

export interface DraftEvidence {
  label: string;
  value: string;
}

/** A word offered for the final name, with every source it appears in. */
export interface NameTerm {
  term: string;
  sources: string[];
}

export interface DraftProblem {
  field: DraftField | "roblox" | "answers";
  message: string;
}

export interface NominationView {
  sku: string;
  itemName: string;
  // version: the draft's updatedAt, sent back on confirmation so only the answers Arjun saw are recorded.
  draft: { id: string; version: string; attemptNo: number; state: string; fields: DraftFields; approvals: NominationApprovals; submittedAt: string | null; submissionEvidence: string | null } | null;
  history: { attemptNo: number; state: string; submittedAt: string | null }[];
  proposed: DraftFields;
  nameTerms: NameTerm[];
  hasNameEvidence: boolean;
  // Each word of the current name and the sources that support it; empty sources means unsupported.
  nameWords: { word: string; sources: string[]; conflictOnly: boolean }[];
  nameEvidence: NameEvidenceView[];
  // Whether each approval still matches the saved value, and where it was reviewed.
  approvedNow: Record<ApprovableField, { approved: boolean; reviewRef: string | null }>;
  // Roblox's own type for the main listing, from the latest check, e.g. "Back accessory (AssetTypeId 46)".
  robloxType: string | null;
  evidence: DraftEvidence[];
  problems: DraftProblem[];
  suggestions: { id: string; field: string; value: string; evidence: string | null; suggestedBy: string | null; status: string }[];
  events: { kind: string; payload: Record<string, unknown>; createdAt: string }[];
  owner: { username: string; email: string };
  formVersion: string;
}

/** Input: free text. Output: the season or holiday it names, or "". */
export function seasonFrom(text: string): string {
  return SEASON_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? "";
}

// Words in a text, including the readable slug of any catalog or Pinterest link in it
// (".../catalog/72992511107820/Tactical-Belt-with-Phone-4-0" gives "Tactical Belt with Phone").
function words(text: string): string[] {
  const slugs = [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0].split("/").filter((part) => /[a-z]/i.test(part) && !part.includes(".")).join(" ").replace(/[-_]/g, " "));
  const plain = text.replace(/https?:\/\/\S+/g, " ");
  return [plain, ...slugs]
    .join(" ")
    .split(/[^A-Za-z']+/)
    .map((w) => w.toLowerCase().replace(/^'+|'+$/g, ""))
    .filter((w) => w.length >= MIN_TERM_CHARS && !STOP_WORDS.has(w));
}

/**
 * The words the linked artifacts and the trend origin offer for a final name, ranked by how many
 * sources use them. The internal item name is not a source.
 *
 * Input: one preview item. Output: up to MAX_NAME_TERMS words, each with its sources.
 */
export function nameTerms(item: PreviewItem): NameTerm[] {
  const sources: { label: string; text: string }[] = [
    ...item.nameEvidence.filter((e) => !e.conflict).map((e) => ({ label: evidenceLabel(e), text: `${e.quote} ${e.supports.join(" ")}` })),
    ...item.artifacts.map((a) => ({ label: `Artifact ${a.artifactId}`, text: [a.title, a.description ?? "", a.tags.join(" ")].join(" ") })),
  ];
  if (item.trendReasoning) sources.push({ label: "Trend origin", text: item.trendReasoning });
  const found = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const word of words(source.text)) found.set(word, (found.get(word) ?? new Set()).add(source.label));
  }
  return [...found.entries()]
    .map(([term, from]) => ({ term, sources: [...from] }))
    .sort((a, b) => b.sources.length - a.sources.length || a.term.localeCompare(b.term))
    .slice(0, MAX_NAME_TERMS);
}

// "glasses" and "glass", "bopper" and "boppers" match: a trailing s is ignored when comparing.
function wordKey(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

// Every word of the SKU's evidence, keyed by wordKey, with each source record it appears in. Sources
// are told apart by their id (an evidence record's id, the artifact id, or "trend"), never by their
// label: two records can share a label such as "head-ranking row 58", and one of them may be marked
// as conflicting. Sources: naming evidence records (full quote and the words they list as
// supported), linked artifacts, and the trend origin.
function evidenceWordSources(item: PreviewItem): Map<string, { id: string; label: string; conflict: boolean }[]> {
  const sources: { id: string; label: string; text: string; conflict: boolean }[] = [
    ...item.nameEvidence.map((e) => ({ id: `evidence:${e.id}`, label: evidenceLabel(e), text: `${e.quote} ${e.supports.join(" ")}`, conflict: !!e.conflict })),
    ...item.artifacts.map((a) => ({ id: `artifact:${a.artifactId}`, label: `Artifact ${a.artifactId}`, text: [a.title, a.description ?? "", a.tags.join(" ")].join(" "), conflict: false })),
  ];
  if (item.trendReasoning) sources.push({ id: "trend", label: "Trend origin", text: item.trendReasoning, conflict: false });
  const found = new Map<string, { id: string; label: string; conflict: boolean }[]>();
  for (const source of sources) {
    for (const word of new Set(words(source.text).map(wordKey))) {
      const list = found.get(word) ?? [];
      if (!list.some((s) => s.id === source.id)) list.push({ id: source.id, label: source.label, conflict: source.conflict });
      found.set(word, list);
    }
  }
  return found;
}

/**
 * Each meaningful word of a name with the evidence sources that contain it. conflictOnly is true
 * when every source record for the word is marked as conflicting. Filler words and words under 3
 * letters are not checked. A label shared by two records is shown once, marked when one of them
 * is conflicting.
 *
 * Input: the name and the SKU's preview. Output: one entry per word, in name order.
 */
export function nameWordSources(name: string, item: PreviewItem): { word: string; sources: string[]; conflictOnly: boolean }[] {
  const known = evidenceWordSources(item);
  return words(name).map((word) => {
    const records = known.get(wordKey(word)) ?? [];
    const labels: string[] = [];
    for (const r of records) {
      const label = r.conflict ? `${r.label} (conflicting)` : r.label;
      if (!labels.includes(label)) labels.push(label);
    }
    return { word, sources: labels, conflictOnly: records.length > 0 && records.every((r) => r.conflict) };
  });
}

/** The words of a name that no evidence source contains. A name can be approved only when this is empty. */
export function unsupportedNameWords(name: string, item: PreviewItem): string[] {
  return nameWordSources(name, item)
    .filter((w) => w.sources.length === 0)
    .map((w) => w.word);
}

/** The words of a name backed only by evidence marked as conflicting. Also refused. */
export function conflictOnlyNameWords(name: string, item: PreviewItem): string[] {
  return nameWordSources(name, item)
    .filter((w) => w.conflictOnly)
    .map((w) => w.word);
}

/** True when the SKU has naming evidence, linked artifacts or a trend origin to ground a name in. */
export function hasNameEvidence(item: PreviewItem): boolean {
  return item.nameEvidence.length > 0 || item.artifacts.length > 0 || !!item.trendReasoning;
}

function approvalState(fields: DraftFields | null, approvals: NominationApprovals): NominationView["approvedNow"] {
  const current: Record<ApprovableField, string | null> = {
    final_name: fields ? (fields.final_name ?? "").trim() : null,
    colour_links: fields ? (fields.colour_links ?? "").trim() : null,
    answers: fields ? answersValue(fields) : null,
  };
  return Object.fromEntries(
    APPROVABLE_FIELDS.map((f) => [f, { approved: current[f] !== null && approvals[f]?.value === current[f], reviewRef: approvals[f]?.reviewRef ?? null }])
  ) as NominationView["approvedNow"];
}

/** The item-page answers approved together, as one comparable value. */
export function answersValue(fields: DraftFields): string {
  return JSON.stringify(ANSWER_FIELDS.map((f) => [f, (fields[f] ?? "").trim()]));
}

/** Input: one preview item. Output: Roblox's own type for its main (or first checked) listing, or null. */
export function robloxTypeOf(item: PreviewItem): string | null {
  const id = mainListing(item)?.lastCheck?.assetTypeId ?? item.listings.find((l) => l.lastCheck?.assetTypeId)?.lastCheck?.assetTypeId ?? null;
  if (id === null) return null;
  return `${ROBLOX_ACCESSORY_TYPE[id] ?? "Roblox asset type"} (AssetTypeId ${id})`;
}

/**
 * Discovery tags from the approved name, the evidence words and the Roblox slot, lower-case and
 * comma-separated, cut to the form's 80 characters.
 */
export function proposeTags(name: string, terms: string[], assetTypeId: number | null): string {
  const tags: string[] = [];
  const add = (tag: string) => {
    const clean = tag.toLowerCase().replace(/[^a-z0-9 '-]/g, "").trim();
    if (clean.length >= MIN_TERM_CHARS && !STOP_WORDS.has(clean) && !tags.includes(clean)) tags.push(clean);
  };
  name.split(/\s+/).forEach(add);
  terms.forEach(add);
  const slot = assetTypeId !== null ? ASSET_TYPE_SLOT[assetTypeId] : undefined;
  if (slot) add(`${slot} accessory`);
  let out = "";
  for (const tag of tags) {
    const next = out ? `${out}, ${tag}` : tag;
    if (next.length > FIELD_LIMITS.tags) break;
    out = next;
  }
  return out;
}

function mainListing(item: PreviewItem): PreviewListing | undefined {
  return item.listings.find((l) => l.isMain);
}

// Recolours offered for review: ticked on sale by us, not reported off sale by Roblox, not the main one.
function candidateColourListings(item: PreviewItem): PreviewListing[] {
  const main = mainListing(item);
  const seen = new Set<string>(main?.robloxAssetId ? [main.robloxAssetId] : []);
  return item.listings.filter((l) => {
    if (l.id === main?.id || !l.onSaleAt || l.lastCheck?.isForSale === false || !l.robloxAssetId || seen.has(l.robloxAssetId)) return false;
    seen.add(l.robloxAssetId);
    return true;
  });
}

/**
 * The Kanban's suggested answers and the evidence shown with them. The final name is left empty:
 * it is built by Arjun from the evidence words or taken from a grounded suggestion.
 *
 * Input: one preview item, and the approved name if any. Output: suggestions, name words, evidence.
 */
export function proposeDraft(item: PreviewItem, approvedName = ""): { proposed: DraftFields; terms: NameTerm[]; evidence: DraftEvidence[] } {
  const main = mainListing(item);
  const assetTypeId = main?.lastCheck?.assetTypeId ?? item.listings.find((l) => l.lastCheck?.assetTypeId)?.lastCheck?.assetTypeId ?? null;
  const terms = nameTerms(item);
  const evidenceText = [approvedName, item.trendReasoning ?? "", ...item.artifacts.map((a) => `${a.title} ${a.description ?? ""} ${a.tags.join(" ")}`)].join(" ");
  const proposed: DraftFields = {
    final_name: "",
    item_link: main?.url ?? "",
    item_type: assetTypeId !== null ? (ASSET_TYPE_TO_ITEM_TYPE[assetTypeId] ?? "") : "",
    tags: proposeTags(approvedName, terms.map((t) => t.term), assetTypeId),
    colour_links: candidateColourListings(item).map((l) => l.url).join("\n"),
    season: seasonFrom(evidenceText),
  };

  const evidence: DraftEvidence[] = [];
  if (item.trendReasoning) evidence.push({ label: "Trend origin", value: item.trendReasoning });
  for (const a of item.artifacts) evidence.push({ label: `Artifact ${a.artifactId}`, value: [a.title, a.description, a.tags.length ? `tags: ${a.tags.join(", ")}` : ""].filter(Boolean).join(" · ") });
  const robloxNames = [...new Set(item.listings.map((l) => l.lastCheck?.robloxName).filter((n): n is string => !!n))];
  if (robloxNames.length) evidence.push({ label: "Current Roblox names (not a naming source)", value: robloxNames.join(", ") });
  if (assetTypeId !== null) evidence.push({ label: "Roblox item type", value: `AssetTypeId ${assetTypeId}${ASSET_TYPE_SLOT[assetTypeId] ? ` (${ASSET_TYPE_SLOT[assetTypeId]} accessory)` : ""}` });
  if (!hasNameEvidence(item)) evidence.push({ label: "Missing evidence", value: "No naming evidence, linked artifacts or trend origin. Add rows to the sheet's Evidence tab before approving a name." });
  if (item.artifacts.length === 0) evidence.push({ label: "Design origin", value: "No historical design-origin link. Naming evidence doesn't need one, and doesn't create one." });
  return { proposed, terms, evidence };
}

function colourLines(value: string | undefined): string[] {
  return (value ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

/**
 * What stops these answers from being filed. Empty means every item-page field passes; it says
 * nothing about the form pages after Next, which haven't been verified.
 *
 * Input: the saved answers, their approvals and the SKU's preview. Output: one problem per failed rule.
 */
export function draftProblems(fields: DraftFields, approvals: NominationApprovals, item: PreviewItem): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const v = (f: DraftField) => (fields[f] ?? "").trim();
  const listingsById = new Map(item.listings.filter((l) => l.robloxAssetId).map((l) => [l.robloxAssetId as string, l]));
  const main = mainListing(item);

  const name = v("final_name");
  if (!hasNameEvidence(item)) problems.push({ field: "final_name", message: "Add naming evidence in the sheet's Evidence tab before approving a name" });
  if (!name) problems.push({ field: "final_name", message: "Set a final name from the evidence" });
  else if (name.length > FIELD_LIMITS.final_name) problems.push({ field: "final_name", message: `Final name is ${name.length} characters; the limit is ${FIELD_LIMITS.final_name}` });
  else if (isPlaceholderName(name)) problems.push({ field: "final_name", message: "Final name looks like a placeholder" });
  else if (unsupportedNameWords(name, item).length) problems.push({ field: "final_name", message: `Not in any evidence for this SKU: ${unsupportedNameWords(name, item).join(", ")}` });
  else if (conflictOnlyNameWords(name, item).length) problems.push({ field: "final_name", message: `Only conflicting evidence supports: ${conflictOnlyNameWords(name, item).join(", ")}` });
  else if (approvals.final_name?.value !== name) problems.push({ field: "final_name", message: "Approve the final name" });

  if (approvals.answers?.value !== answersValue(fields)) problems.push({ field: "answers", message: "Approve the item-page answers" });

  const link = parseRobloxCatalogLink(v("item_link"));
  if (!main) problems.push({ field: "item_link", message: "Choose a main listing" });
  else if (typeof link === "string") problems.push({ field: "item_link", message: `Item link: ${link}` });
  else if (link.assetId !== main.robloxAssetId) problems.push({ field: "item_link", message: "Item link isn't this SKU's main listing" });

  if (!ITEM_TYPES.includes(v("item_type") as (typeof ITEM_TYPES)[number])) problems.push({ field: "item_type", message: "Pick an item type" });
  const tags = v("tags");
  if (!tags) problems.push({ field: "tags", message: "Tags are required" });
  else if (tags.length > FIELD_LIMITS.tags) problems.push({ field: "tags", message: `Tags are ${tags.length} characters; the limit is ${FIELD_LIMITS.tags}` });
  if (v("audience") && !AUDIENCES.includes(v("audience") as (typeof AUDIENCES)[number])) problems.push({ field: "audience", message: "Audience must be one of the form's three choices, or blank" });
  for (const f of ["season", "extra_info", "theme"] as const) {
    if (v(f).length > FIELD_LIMITS[f]) problems.push({ field: f, message: `${f.replace("_", " ")} is ${v(f).length} characters; the limit is ${FIELD_LIMITS[f]}` });
  }

  // Colour links must be this SKU's own listings: valid, distinct, not the main one, and reviewed.
  const seen = new Set<string>();
  const colourListings: PreviewListing[] = [];
  for (const line of colourLines(fields.colour_links)) {
    const parsed = parseRobloxCatalogLink(line);
    if (typeof parsed === "string") {
      problems.push({ field: "colour_links", message: `Colour link "${line}": ${parsed}` });
      continue;
    }
    const listing = listingsById.get(parsed.assetId);
    if (!listing) problems.push({ field: "colour_links", message: `Colour link ${parsed.assetId} isn't one of this SKU's listings` });
    else if (parsed.assetId === main?.robloxAssetId) problems.push({ field: "colour_links", message: "The main listing can't also be a colour link" });
    else if (seen.has(parsed.assetId)) problems.push({ field: "colour_links", message: `Colour link ${parsed.assetId} is listed twice` });
    else colourListings.push(listing);
    seen.add(parsed.assetId);
  }
  const reviewNeeded = colourLines(fields.colour_links).length > 0 || candidateColourListings(item).length > 0;
  if (reviewNeeded && approvals.colour_links?.value !== (fields.colour_links ?? "").trim()) problems.push({ field: "colour_links", message: "Review and approve the colour links" });

  // The Roblox listings themselves must carry real names before nominating.
  const mainName = main?.lastCheck?.robloxName;
  if (main && !main.lastCheck) problems.push({ field: "roblox", message: "Check the main listing on Roblox" });
  else if (main && name && mainName && mainName.trim().toLowerCase() !== name.toLowerCase()) problems.push({ field: "roblox", message: `Rename the main listing on Roblox from "${mainName}" to "${name}", then check it again` });
  if (main?.lastCheck && main.lastCheck.isForSale === false) problems.push({ field: "roblox", message: "Roblox shows the main listing off sale" });
  const placeholders = colourListings.filter((l) => l.lastCheck?.robloxName && isPlaceholderName(l.lastCheck.robloxName));
  if (placeholders.length) problems.push({ field: "roblox", message: `Rename recolours with placeholder names on Roblox: ${placeholders.map((l) => l.lastCheck!.robloxName).join(", ")}` });
  return problems;
}

async function findItem(sku: string): Promise<{ item: PreviewItem; assetId: string }> {
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
  const item = (await listTodaysPicksPreview()).find((i) => i.sku === sku);
  if (!asset || !item) throw new TodaysPicksError(`${sku} isn't a live SKU with Roblox links`);
  return { item, assetId: asset.id };
}

// JSON with object keys sorted: Postgres jsonb doesn't keep key order, so a stored value and the
// same value sent again must hash alike.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 32);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Every state change gets its own event: the key is unique per change, and the conditional update
// in the same transaction is what stops a retry from recording the change twice.
async function addEvent(tx: Tx, draftId: string, kind: string, payload: Record<string, unknown>, actorId: string | null): Promise<void> {
  await tx.insert(nominationEvents).values({ draftId, eventKey: `${kind}:${randomUUID()}`, kind, payload, actorId });
}

async function latestDraft(assetId: string) {
  const [row] = await db.select().from(nominationDrafts).where(eq(nominationDrafts.assetId, assetId)).orderBy(desc(nominationDrafts.attemptNo)).limit(1);
  return row ?? null;
}

/** Input: a SKU. Output: everything the nomination panel shows for it. */
export async function getNomination(sku: string): Promise<NominationView> {
  const { item, assetId } = await findItem(sku);
  const [drafts, suggestions] = await Promise.all([
    db.select().from(nominationDrafts).where(eq(nominationDrafts.assetId, assetId)).orderBy(desc(nominationDrafts.attemptNo)),
    db.select().from(marketingSuggestions).where(eq(marketingSuggestions.assetId, assetId)).orderBy(desc(marketingSuggestions.createdAt)),
  ]);
  const draft = drafts[0] ?? null;
  const events = draft ? await db.select().from(nominationEvents).where(eq(nominationEvents.draftId, draft.id)).orderBy(desc(nominationEvents.createdAt)) : [];
  const approvals = (draft?.approvals ?? {}) as NominationApprovals;
  const { proposed, terms, evidence } = proposeDraft(item, approvals.final_name?.value ?? "");
  // An unsaved SKU is checked against the suggestions, so the panel shows what blocks them too.
  const current = draft ? (draft.fields as DraftFields) : proposed;
  return {
    sku,
    itemName: item.itemName,
    draft: draft && {
      id: draft.id,
      version: draft.updatedAt.toISOString(),
      attemptNo: draft.attemptNo,
      state: draft.state,
      fields: draft.fields as DraftFields,
      approvals,
      submittedAt: draft.submittedAt?.toISOString() ?? null,
      submissionEvidence: draft.submissionEvidence,
    },
    history: drafts.map((d) => ({ attemptNo: d.attemptNo, state: d.state, submittedAt: d.submittedAt?.toISOString() ?? null })),
    proposed,
    nameTerms: terms,
    hasNameEvidence: hasNameEvidence(item),
    nameWords: nameWordSources((current.final_name ?? "").trim(), item),
    nameEvidence: item.nameEvidence,
    approvedNow: approvalState(draft ? (draft.fields as DraftFields) : null, approvals),
    robloxType: robloxTypeOf(item),
    evidence,
    problems: draftProblems(current, approvals, item),
    suggestions: suggestions.map((s) => ({ id: s.id, field: s.field, value: s.value, evidence: s.evidence, suggestedBy: s.suggestedBy, status: s.status })),
    events: events.map((e) => ({ kind: e.kind, payload: e.payload, createdAt: e.createdAt.toISOString() })),
    owner: { username: NOMINATION_USERNAME, email: NOMINATION_EMAIL },
    formVersion: FORM_VERSION,
  };
}

function cleanFields(fields: DraftFields): DraftFields {
  const out: DraftFields = {};
  for (const f of DRAFT_FIELDS) if (typeof fields[f] === "string") out[f] = (fields[f] as string).trim();
  return out;
}

/**
 * Saves Arjun's answers to the SKU's open draft, making attempt 1 when there is none. Saving never
 * approves anything: a changed name or colour list needs approving again. A filed nomination can't
 * be edited. Saving unchanged answers records nothing.
 *
 * Input: the SKU, the answers, who saved. Output: the draft id.
 */
export async function saveDraft(sku: string, fields: DraftFields, actorId: string | null): Promise<string> {
  const { assetId } = await findItem(sku);
  const clean = cleanFields(fields);
  const latest = await latestDraft(assetId);
  if (latest && latest.state !== "draft") throw new TodaysPicksError("This SKU's nomination is recorded as filed. Undo the confirmation first if it was wrong");
  return db.transaction(async (tx) => {
    if (latest) {
      const [locked] = await tx.select().from(nominationDrafts).where(eq(nominationDrafts.id, latest.id)).for("update");
      if (locked.state !== "draft") throw new TodaysPicksError("This SKU's nomination is recorded as filed. Undo the confirmation first if it was wrong");
      if (hashOf(locked.fields) === hashOf(clean)) return latest.id;
      const updated = await tx
        .update(nominationDrafts)
        .set({ fields: clean, updatedAt: new Date() })
        .where(and(eq(nominationDrafts.id, latest.id), eq(nominationDrafts.state, "draft")))
        .returning({ id: nominationDrafts.id });
      if (updated.length === 0) throw new TodaysPicksError("The draft changed while saving. Reload and try again");
      await addEvent(tx, latest.id, "saved", { fields: clean }, actorId);
      return latest.id;
    }
    const [created] = await tx
      .insert(nominationDrafts)
      .values({ assetId, attemptNo: 1, formVersion: FORM_VERSION, fields: clean, createdBy: actorId })
      .onConflictDoNothing()
      .returning({ id: nominationDrafts.id });
    if (!created) throw new TodaysPicksError("Another save made this draft a moment ago. Reload and try again");
    await addEvent(tx, created.id, "saved", { fields: clean }, actorId);
    return created.id;
  });
}

/**
 * Approves the saved final name, colour links or item-page answers exactly as Arjun reviewed them.
 * The draft row is locked and must still be the version his panel showed, so a value changed after
 * review is never approved. A final name needs evidence for every word, none backed only by
 * conflicting evidence, a value and the 49-character limit. Colour links and answers must pass
 * their own checks. reviewRef records where the review happened, e.g. an earlier review of the same
 * values, so an approval made elsewhere is carried into the Kanban without reviewing it again.
 *
 * Input: the SKU, the draft id and version, which field, an optional review reference, who approved.
 * Output: nothing.
 */
export async function approveField(
  sku: string,
  input: { draftId: string; version: string; field: ApprovableField; reviewRef?: string | null },
  actorId: string | null
): Promise<void> {
  const { item, assetId } = await findItem(sku);
  const reviewRef = input.reviewRef?.trim().slice(0, MAX_REVIEW_REF_CHARS) || null;
  await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(nominationDrafts)
      .where(and(eq(nominationDrafts.id, input.draftId), eq(nominationDrafts.assetId, assetId)))
      .for("update");
    if (!draft || draft.state !== "draft") throw new TodaysPicksError("Only an open draft can be approved");
    if (draft.updatedAt.toISOString() !== input.version) throw new TodaysPicksError("The draft changed after you reviewed it. Reload and check it again");
    const fields = draft.fields as DraftFields;
    let value: string;
    if (input.field === "final_name") {
      value = (fields.final_name ?? "").trim();
      if (!hasNameEvidence(item)) throw new TodaysPicksError("Add naming evidence in the sheet's Evidence tab before approving a name");
      if (!value || value.length > MAX_FINAL_NAME_CHARS || isPlaceholderName(value)) throw new TodaysPicksError(`Save a real final name of at most ${MAX_FINAL_NAME_CHARS} characters first`);
      const unsupported = unsupportedNameWords(value, item);
      if (unsupported.length) throw new TodaysPicksError(`These words aren't in any evidence for this SKU: ${unsupported.join(", ")}`);
      const conflictOnly = conflictOnlyNameWords(value, item);
      if (conflictOnly.length) throw new TodaysPicksError(`Only conflicting evidence supports: ${conflictOnly.join(", ")}`);
    } else if (input.field === "colour_links") {
      value = (fields.colour_links ?? "").trim();
      const colourProblems = draftProblems(fields, { colour_links: { value, by: null, at: "" } }, item).filter((p) => p.field === "colour_links");
      if (colourProblems.length) throw new TodaysPicksError(colourProblems.map((p) => p.message).join("; "));
    } else {
      value = answersValue(fields);
      const limitProblems = draftProblems(fields, {}, item).filter((p) => ["item_type", "tags", "audience", "season", "extra_info", "theme"].includes(p.field));
      if (limitProblems.length) throw new TodaysPicksError(limitProblems.map((p) => p.message).join("; "));
    }
    const approvals: NominationApprovals = { ...(draft.approvals as NominationApprovals), [input.field]: { value, by: actorId, at: new Date().toISOString(), reviewRef } };
    await tx.update(nominationDrafts).set({ approvals, updatedAt: new Date() }).where(eq(nominationDrafts.id, draft.id));
    await addEvent(tx, draft.id, `approved_${input.field}`, { value, reviewRef, version: input.version }, actorId);
  });
}

/**
 * Records Arjun's own confirmation that he filed this nomination on Roblox's form. It is not
 * verified with Roblox, and it covers the form's item page only.
 *
 * The draft row is locked (SELECT ... FOR UPDATE) for the whole transaction, and its version must
 * equal the one Arjun's panel loaded, so an edit or approval made after he reviewed it is never
 * recorded as filed: a save that started first makes the version differ, and a save that starts
 * later waits for the lock and then finds the draft filed. The answers are re-checked on the locked
 * row. The state change, history event, audit row and task comment commit together or not at all.
 *
 * Input: the SKU, the draft id and version, the rights confirmation, optional proof, who confirmed.
 * Output: when it was recorded, and whether it already was.
 */
export async function confirmSubmitted(
  sku: string,
  input: { draftId: string; version: string; rightsConfirmed: boolean; evidence: string | null },
  actorId: string | null
): Promise<{ submittedAt: string; alreadyRecorded: boolean }> {
  const { item, assetId } = await findItem(sku);
  if (input.rightsConfirmed !== true) throw new TodaysPicksError("Confirm you answered the rights question on the form yourself");
  const evidence = input.evidence?.trim() || null;
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(nominationDrafts)
      .where(and(eq(nominationDrafts.id, input.draftId), eq(nominationDrafts.assetId, assetId)))
      .for("update");
    if (!draft) throw new TodaysPicksError("That draft isn't this SKU's");
    // A second confirmation of the same reviewed version, e.g. a double click, records nothing new.
    if (draft.state === "submitted") return { submittedAt: draft.submittedAt!.toISOString(), alreadyRecorded: true };
    if (draft.state !== "draft") throw new TodaysPicksError("Only an open draft can be confirmed");
    if (draft.updatedAt.toISOString() !== input.version) throw new TodaysPicksError("The draft changed after you reviewed it. Reload, check the answers and confirm again");
    const fields = draft.fields as DraftFields;
    const problems = draftProblems(fields, draft.approvals as NominationApprovals, item);
    if (problems.length) throw new TodaysPicksError(`Fix these first: ${problems.map((p) => p.message).join("; ")}`);

    const now = new Date();
    await tx.update(nominationDrafts).set({ state: "submitted", submittedAt: now, submittedBy: actorId, submissionEvidence: evidence, updatedAt: now }).where(eq(nominationDrafts.id, draft.id));
    const colours = colourLines(fields.colour_links).length;
    await addEvent(tx, draft.id, "owner_confirmed_filed", { fields, approvals: draft.approvals, version: input.version, evidence, formVersion: draft.formVersion, verifiedWithRoblox: false }, actorId);
    await tx.insert(auditLog).values({ action: "confirmTodaysPicksNomination", entityType: "asset", entityId: assetId, actorId, payload: { sku, draftId: draft.id, attemptNo: draft.attemptNo } });
    await tx.insert(teamTaskComments).values({
      taskId: MARKETING_TASK_ID,
      authorId: actorId,
      body:
        `Arjun confirmed he filed a Today's Picks nomination for ${fields.final_name} (${sku}): ${fields.item_link}` +
        `${colours ? ` plus ${colours} colour link${colours === 1 ? "" : "s"}` : ""}. Tags: ${fields.tags}.` +
        ` Owner-confirmed, not verified with Roblox. Answers cover the form's item page only (${draft.formVersion}).` +
        `${evidence ? ` Proof noted: ${evidence}.` : ""} Roblox picks items and only contacts selected creators.`,
    });
    return { submittedAt: now.toISOString(), alreadyRecorded: false };
  });
}

/**
 * Corrects a confirmation recorded by mistake: the attempt goes back to a draft, and the history
 * keeps the confirmation and the correction with its reason. One transaction, like confirming.
 * Refuses with a clear error when the SKU already has another open draft.
 */
export async function undoSubmitted(sku: string, draftId: string, reason: string, actorId: string | null): Promise<void> {
  const { assetId } = await findItem(sku);
  if (reason.trim().length < MIN_UNDO_REASON_CHARS) throw new TodaysPicksError("Say why the confirmation was wrong");
  const [otherOpen] = await db
    .select({ id: nominationDrafts.id })
    .from(nominationDrafts)
    .where(and(eq(nominationDrafts.assetId, assetId), eq(nominationDrafts.state, "draft"), ne(nominationDrafts.id, draftId)));
  if (otherOpen) throw new TodaysPicksError("This SKU already has another open draft, so this confirmation can't be reopened");
  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(nominationDrafts)
        .set({ state: "draft", submittedAt: null, submittedBy: null, submissionEvidence: null, updatedAt: new Date() })
        .where(and(eq(nominationDrafts.id, draftId), eq(nominationDrafts.assetId, assetId), eq(nominationDrafts.state, "submitted")))
        .returning({ id: nominationDrafts.id, attemptNo: nominationDrafts.attemptNo });
      if (updated.length === 0) throw new TodaysPicksError("That attempt isn't recorded as filed");
      await addEvent(tx, draftId, "confirmation_undone", { reason: reason.trim() }, actorId);
      await tx.insert(auditLog).values({ action: "undoTodaysPicksNomination", entityType: "asset", entityId: assetId, actorId, payload: { sku, draftId, reason: reason.trim() } });
      await tx.insert(teamTaskComments).values({
        taskId: MARKETING_TASK_ID,
        authorId: actorId,
        body: `Correction: the Today's Picks filing recorded for ${sku} (attempt ${updated[0].attemptNo}) was undone. Reason: ${reason.trim()}`,
      });
    });
  } catch (err) {
    // Another draft opened between the check above and this update.
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new TodaysPicksError("This SKU already has another open draft, so this confirmation can't be reopened");
    throw err;
  }
}

/** Marks a sheet suggestion used or dismissed. Using one only fills the panel; Arjun still saves and approves. */
export async function setSuggestionStatus(sku: string, suggestionId: string, status: "used" | "dismissed"): Promise<void> {
  const { assetId } = await findItem(sku);
  const updated = await db
    .update(marketingSuggestions)
    .set({ status })
    .where(and(eq(marketingSuggestions.id, suggestionId), eq(marketingSuggestions.assetId, assetId)))
    .returning({ id: marketingSuggestions.id });
  if (updated.length === 0) throw new TodaysPicksError("That suggestion isn't this SKU's");
}

/** Output: per SKU, the latest attempt's state, approved name and filing time, for the grid and the sheet. */
export async function nominationSummaries(): Promise<Map<string, { state: string; finalName: string; submittedAt: string | null; attemptNo: number }>> {
  const rows = await db
    .select({ sku: assets.sku, state: nominationDrafts.state, approvals: nominationDrafts.approvals, submittedAt: nominationDrafts.submittedAt, attemptNo: nominationDrafts.attemptNo })
    .from(nominationDrafts)
    .innerJoin(assets, eq(assets.id, nominationDrafts.assetId))
    .orderBy(desc(nominationDrafts.attemptNo));
  const out = new Map<string, { state: string; finalName: string; submittedAt: string | null; attemptNo: number }>();
  for (const r of rows) {
    if (out.has(r.sku)) continue;
    out.set(r.sku, { state: r.state, finalName: (r.approvals as NominationApprovals).final_name?.value ?? "", submittedAt: r.submittedAt?.toISOString() ?? null, attemptNo: r.attemptNo });
  }
  return out;
}

export interface SuggestionRow {
  sku: string;
  listingId: string;
  field: string;
  value: string;
  evidence: string;
  suggestedBy: string;
  suggestedAt: string;
}

/**
 * Stores new rows from the sheet's Suggestions tab. A row is skipped (and counted) when its SKU
 * isn't live, its field isn't one a suggestion may fill, its value breaks the field's limit, or
 * its listing isn't the SKU's. Re-reading a row stores nothing new.
 *
 * Input: the rows and the live SKUs. Output: how many were new, already known, and refused.
 */
export async function ingestSuggestions(rows: SuggestionRow[], items: PreviewItem[]): Promise<{ added: number; known: number; refused: { row: number; reason: string }[] }> {
  const skuAssets = await db.select({ id: assets.id, sku: assets.sku }).from(assets).where(inArray(assets.sku, items.map((i) => i.sku).concat(["-"])));
  const assetBySku = new Map(skuAssets.map((a) => [a.sku, a.id]));
  const result = { added: 0, known: 0, refused: [] as { row: number; reason: string }[] };
  for (const [index, row] of rows.entries()) {
    const sheetRow = index + 2;
    const item = items.find((i) => i.sku === row.sku.trim());
    const assetId = assetBySku.get(row.sku.trim());
    const field = row.field.trim() as DraftField;
    const value = row.value.trim();
    const limit = (FIELD_LIMITS as Record<string, number>)[field];
    let reason: string | null = null;
    if (!item || !assetId) reason = `SKU "${row.sku}" isn't live`;
    else if (!SUGGESTIBLE_FIELDS.includes(field)) reason = `field must be one of ${SUGGESTIBLE_FIELDS.join(", ")}`;
    else if (!value) reason = "empty value";
    else if (limit && value.length > limit) reason = `${field} is ${value.length} characters; the limit is ${limit}`;
    else if (row.listingId.trim() && !item.listings.some((l) => l.id === row.listingId.trim())) reason = "listing_id isn't this SKU's";
    if (reason) {
      result.refused.push({ row: sheetRow, reason });
      continue;
    }
    const inserted = await db
      .insert(marketingSuggestions)
      .values({
        assetId: assetId!,
        listingId: row.listingId.trim() || null,
        field,
        value,
        evidence: row.evidence.trim() || null,
        suggestedBy: row.suggestedBy.trim() || null,
        suggestedAt: row.suggestedAt.trim() || null,
        rowHash: hashOf([row.sku.trim(), row.listingId.trim(), field, value, row.evidence.trim(), row.suggestedBy.trim()]),
      })
      .onConflictDoNothing()
      .returning({ id: marketingSuggestions.id });
    if (inserted.length) result.added++;
    else result.known++;
  }
  return result;
}
