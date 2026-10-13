// Today's Picks nomination drafts (stages 2 and 3). For each live SKU the Kanban proposes a final
// name and form answers from the SKU's own data, shows the evidence behind them, and checks them
// against the form's limits. Arjun edits and approves, files the nomination himself on Roblox's
// form, then confirms it here. Nothing here submits anything to Roblox, renames a listing, or marks
// a nomination submitted without Arjun's confirmation.
//
// The form's fields and limits are in nomination-fields.ts.

import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { nominationDrafts, nominationEvents } from "@/lib/db/schema/nomination_drafts";
import { marketingSuggestions } from "@/lib/db/schema/marketing_suggestions";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { auditLog } from "@/lib/db/schema/audit_log";
import { parseRobloxCatalogLink } from "@/lib/publisher/roblox-links";
import { isPlaceholderName, listTodaysPicksPreview, TodaysPicksError, type PreviewItem, type PreviewListing } from "./todays-picks-service";
import { AUDIENCES, DRAFT_FIELDS, FIELD_LIMITS, FORM_VERSION, ITEM_TYPES, MAX_FINAL_NAME_CHARS, type DraftField, type DraftFields } from "./nomination-fields";

export { DRAFT_FIELDS, FORM_VERSION };

// Owner details for the form, settled by Arjun. Shown for copying; never sent anywhere by the Kanban.
export const NOMINATION_USERNAME = "goatgoelrblx";
export const NOMINATION_EMAIL = "arjun@metafashion.in";
// The private "Marketing company function" task; a confirmed nomination is posted there once.
export const MARKETING_TASK_ID = "5749e9a7-f86f-4035-a5fd-1b82e7312b2a";

// Fields a sheet suggestion may target. item_link and colour_links come only from the Kanban's own listings.
export const SUGGESTIBLE_FIELDS: DraftField[] = ["final_name", "item_type", "tags", "audience", "season", "extra_info", "theme"];
const MIN_RENOMINATION_REASON_CHARS = 10;

// Roblox AssetTypeId to the form's item type. Ids from Roblox's AssetType enum.
const ASSET_TYPE_TO_ITEM_TYPE: Record<number, (typeof ITEM_TYPES)[number]> = {
  8: "Accessory / Hair", 41: "Accessory / Hair", 42: "Accessory / Hair", 43: "Accessory / Hair", 44: "Accessory / Hair", 45: "Accessory / Hair", 46: "Accessory / Hair", 47: "Accessory / Hair",
  2: "Clothing / Shoes", 11: "Clothing / Shoes", 12: "Clothing / Shoes", 64: "Clothing / Shoes", 65: "Clothing / Shoes", 66: "Clothing / Shoes", 67: "Clothing / Shoes", 68: "Clothing / Shoes", 69: "Clothing / Shoes", 70: "Clothing / Shoes", 71: "Clothing / Shoes", 72: "Clothing / Shoes",
  27: "Character / Body", 28: "Character / Body", 29: "Character / Body", 30: "Character / Body", 31: "Character / Body",
  17: "Head", 79: "Head",
  61: "Emote",
};
// Roblox's accessory slot names, used as a discovery tag.
const ASSET_TYPE_SLOT: Record<number, string> = { 8: "hat", 41: "hair", 42: "face", 43: "neck", 44: "shoulder", 45: "front", 46: "back", 47: "waist" };
const SEASON_WORDS: [RegExp, string][] = [
  [/christmas|xmas|santa|reindeer|snowman|candy cane/i, "Christmas"],
  [/halloween|spooky|pumpkin/i, "Halloween"],
  [/valentine/i, "Valentine's Day"],
  [/easter/i, "Easter"],
  [/lunar new year/i, "Lunar New Year"],
];
// Words that add nothing to a name or a tag list.
const FILLER_WORDS = new Set(["with", "and", "the", "a", "an", "of", "for", "in", "on", "w"]);

export interface DraftEvidence {
  label: string;
  value: string;
}

export interface DraftProblem {
  field: DraftField | "roblox";
  message: string;
}

export interface NominationView {
  sku: string;
  itemName: string;
  draft: { id: string; attemptNo: number; state: string; fields: DraftFields; submittedAt: string | null; submissionEvidence: string | null; renominationReason: string | null } | null;
  history: { attemptNo: number; state: string; submittedAt: string | null }[];
  proposed: DraftFields;
  evidence: DraftEvidence[];
  problems: DraftProblem[];
  suggestions: { id: string; field: string; value: string; evidence: string | null; suggestedBy: string | null; status: string }[];
  events: { kind: string; payload: Record<string, unknown>; createdAt: string }[];
  owner: { username: string; email: string };
  formVersion: string;
}

function titleCase(word: string): string {
  return word.length <= 2 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Cuts text to at most `max` characters at a word boundary. */
export function fitWords(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : clean.slice(0, max)).replace(/[\s,;/-]+$/, "");
}

/**
 * A starting point for the final name, made only from the item's own words: the internal item name
 * cleaned up (slashes, duplicates and filler removed, title case), cut to the 49-character limit.
 * It is a proposal for Arjun to edit, not a claim about the item.
 */
export function proposeName(itemName: string): string {
  const seen = new Set<string>();
  const words = itemName
    .replace(/[/_|]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => {
      const key = w.toLowerCase();
      if (FILLER_WORDS.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(titleCase);
  return fitWords(words.join(" "), MAX_FINAL_NAME_CHARS);
}

/** Input: free text. Output: the season or holiday it names, or "". */
export function seasonFrom(text: string): string {
  return SEASON_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? "";
}

/**
 * Discovery tags from the name, the Roblox slot and the linked artifacts' tags, lower-case and
 * comma-separated, cut to the form's 80 characters.
 */
export function proposeTags(name: string, assetTypeId: number | null, artifactTags: string[]): string {
  const tags: string[] = [];
  const add = (tag: string) => {
    const clean = tag.toLowerCase().replace(/[^a-z0-9 '-]/g, "").trim();
    if (clean && !FILLER_WORDS.has(clean) && !tags.includes(clean)) tags.push(clean);
  };
  name.split(/\s+/).forEach(add);
  const slot = assetTypeId !== null ? ASSET_TYPE_SLOT[assetTypeId] : undefined;
  if (slot) add(`${slot} accessory`);
  artifactTags.forEach(add);
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

// A recolour goes in the colour links when we ticked it on sale and Roblox didn't say it's off sale.
function colourListings(item: PreviewItem): PreviewListing[] {
  const main = mainListing(item);
  const seen = new Set<string>(main?.robloxAssetId ? [main.robloxAssetId] : []);
  return item.listings.filter((l) => {
    if (l.id === main?.id || !l.onSaleAt || l.lastCheck?.isForSale === false || !l.robloxAssetId || seen.has(l.robloxAssetId)) return false;
    seen.add(l.robloxAssetId);
    return true;
  });
}

/** Input: one preview item. Output: the Kanban's proposed answer for each field it can ground, and the evidence shown with them. */
export function proposeDraft(item: PreviewItem): { proposed: DraftFields; evidence: DraftEvidence[] } {
  const main = mainListing(item);
  const assetTypeId = main?.lastCheck?.assetTypeId ?? item.listings.find((l) => l.lastCheck?.assetTypeId)?.lastCheck?.assetTypeId ?? null;
  const name = proposeName(item.itemName);
  const artifactTags = item.artifacts.flatMap((a) => a.tags);
  const seasonSource = [item.itemName, ...item.artifacts.map((a) => `${a.title} ${a.description ?? ""}`)].join(" ");
  const proposed: DraftFields = {
    final_name: name,
    item_link: main?.url ?? "",
    item_type: assetTypeId !== null ? (ASSET_TYPE_TO_ITEM_TYPE[assetTypeId] ?? "") : "",
    tags: proposeTags(name, assetTypeId, artifactTags),
    colour_links: colourListings(item).map((l) => l.url).join("\n"),
    season: seasonFrom(seasonSource),
  };

  const evidence: DraftEvidence[] = [{ label: "Internal item name", value: item.itemName }];
  if (item.trendReasoning) evidence.push({ label: "Trend origin", value: item.trendReasoning });
  for (const a of item.artifacts) evidence.push({ label: `Artifact ${a.artifactId}`, value: [a.title, a.description, a.tags.length ? `tags: ${a.tags.join(", ")}` : ""].filter(Boolean).join(" · ") });
  const robloxNames = [...new Set(item.listings.map((l) => l.lastCheck?.robloxName).filter((n): n is string => !!n))];
  if (robloxNames.length) evidence.push({ label: "Current Roblox names", value: robloxNames.join(", ") });
  if (assetTypeId !== null) evidence.push({ label: "Roblox item type", value: `AssetTypeId ${assetTypeId}${ASSET_TYPE_SLOT[assetTypeId] ? ` (${ASSET_TYPE_SLOT[assetTypeId]} accessory)` : ""}` });
  if (item.artifacts.length === 0) evidence.push({ label: "Weak evidence", value: "No linked artifacts. The name and tags come from the internal item name only." });
  return { proposed, evidence };
}

/**
 * What stops these answers from being filed. Empty means every known field passes; it says nothing
 * about the form pages after Next, which haven't been seen.
 *
 * Input: the answers and the SKU's preview. Output: one problem per failed rule.
 */
export function draftProblems(fields: DraftFields, item: PreviewItem): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const v = (f: DraftField) => (fields[f] ?? "").trim();
  const ids = new Map(item.listings.filter((l) => l.robloxAssetId).map((l) => [l.robloxAssetId as string, l]));
  const main = mainListing(item);

  const name = v("final_name");
  if (!name) problems.push({ field: "final_name", message: "Approve a final name" });
  else if (name.length > FIELD_LIMITS.final_name) problems.push({ field: "final_name", message: `Final name is ${name.length} characters; the limit is ${FIELD_LIMITS.final_name}` });
  else if (isPlaceholderName(name)) problems.push({ field: "final_name", message: "Final name looks like a placeholder" });

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

  // Colour links must be this SKU's own listings: valid, distinct, not the main one.
  const seen = new Set<string>();
  for (const line of v("colour_links").split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const parsed = parseRobloxCatalogLink(line);
    if (typeof parsed === "string") {
      problems.push({ field: "colour_links", message: `Colour link "${line}": ${parsed}` });
      continue;
    }
    if (!ids.has(parsed.assetId)) problems.push({ field: "colour_links", message: `Colour link ${parsed.assetId} isn't one of this SKU's listings` });
    else if (parsed.assetId === main?.robloxAssetId) problems.push({ field: "colour_links", message: "The main listing can't also be a colour link" });
    else if (seen.has(parsed.assetId)) problems.push({ field: "colour_links", message: `Colour link ${parsed.assetId} is listed twice` });
    seen.add(parsed.assetId);
  }

  // The Roblox listing itself must carry the approved name before nominating.
  const mainName = main?.lastCheck?.robloxName;
  if (main && !main.lastCheck) problems.push({ field: "roblox", message: "Check the main listing on Roblox" });
  else if (main && name && mainName && mainName.trim().toLowerCase() !== name.toLowerCase()) problems.push({ field: "roblox", message: `Rename the main listing on Roblox from "${mainName}" to "${name}", then check it again` });
  if (main?.lastCheck && main.lastCheck.isForSale === false) problems.push({ field: "roblox", message: "Roblox shows the main listing off sale" });
  const placeholderRecolours = colourListings(item).filter((l) => l.lastCheck?.robloxName && isPlaceholderName(l.lastCheck.robloxName));
  if (placeholderRecolours.length) problems.push({ field: "roblox", message: `Rename recolours with placeholder names on Roblox: ${placeholderRecolours.map((l) => l.lastCheck!.robloxName).join(", ")}` });
  return problems;
}

async function findItem(sku: string): Promise<{ item: PreviewItem; assetId: string }> {
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
  const item = (await listTodaysPicksPreview()).find((i) => i.sku === sku);
  if (!asset || !item) throw new TodaysPicksError(`${sku} isn't a live SKU with Roblox links`);
  return { item, assetId: asset.id };
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

async function addEvent(draftId: string, eventKey: string, kind: string, payload: Record<string, unknown>, actorId: string | null): Promise<void> {
  await db.insert(nominationEvents).values({ draftId, eventKey, kind, payload, actorId }).onConflictDoNothing();
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
  const { proposed, evidence } = proposeDraft(item);
  // An unsaved SKU is checked against the proposals, so the panel shows what blocks them too.
  const current = draft ? (draft.fields as DraftFields) : proposed;
  return {
    sku,
    itemName: item.itemName,
    draft: draft && {
      id: draft.id,
      attemptNo: draft.attemptNo,
      state: draft.state,
      fields: draft.fields as DraftFields,
      submittedAt: draft.submittedAt?.toISOString() ?? null,
      submissionEvidence: draft.submissionEvidence,
      renominationReason: draft.renominationReason,
    },
    history: drafts.map((d) => ({ attemptNo: d.attemptNo, state: d.state, submittedAt: d.submittedAt?.toISOString() ?? null })),
    proposed,
    evidence,
    problems: draftProblems(current, item),
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
 * Saves Arjun's reviewed answers to the SKU's open draft, making attempt 1 when there is none. A
 * submitted nomination can't be edited; a change after that goes in a re-nomination.
 *
 * Input: the SKU, the answers, who saved. Output: the draft id. Saving the same answers twice
 * records one event.
 */
export async function saveDraft(sku: string, fields: DraftFields, actorId: string | null): Promise<string> {
  const { assetId } = await findItem(sku);
  const clean = cleanFields(fields);
  const latest = await latestDraft(assetId);
  let draftId: string;
  if (latest?.state === "draft") {
    draftId = latest.id;
    await db.update(nominationDrafts).set({ fields: clean, updatedAt: new Date() }).where(eq(nominationDrafts.id, draftId));
  } else if (latest?.state === "submitted") {
    throw new TodaysPicksError("This SKU's nomination is already submitted. Start a re-nomination to change it");
  } else {
    // onConflictDoNothing: two first saves at once make one draft; the loser saves into the winner's.
    const [created] = await db
      .insert(nominationDrafts)
      .values({ assetId, attemptNo: (latest?.attemptNo ?? 0) + 1, formVersion: FORM_VERSION, fields: clean, createdBy: actorId })
      .onConflictDoNothing()
      .returning({ id: nominationDrafts.id });
    if (created) draftId = created.id;
    else {
      const open = await latestDraft(assetId);
      if (!open || open.state !== "draft") throw new TodaysPicksError("Couldn't save the draft. Reload and try again");
      draftId = open.id;
      await db.update(nominationDrafts).set({ fields: clean, updatedAt: new Date() }).where(eq(nominationDrafts.id, draftId));
    }
  }
  await addEvent(draftId, `save:${hashOf(clean)}`, "saved", { fields: clean }, actorId);
  return draftId;
}

/**
 * Records that Arjun filed this nomination on Roblox's form. Refuses unless the saved answers pass
 * every check and he confirms he made the rights attestation himself. Posts one update on the
 * private marketing task. Calling it again for the same draft changes nothing.
 *
 * Input: the SKU, the draft id, the rights confirmation, optional evidence, who confirmed.
 * Output: when it was recorded.
 */
export async function confirmSubmitted(sku: string, input: { draftId: string; rightsConfirmed: boolean; evidence: string | null }, actorId: string | null): Promise<{ submittedAt: string; alreadyRecorded: boolean }> {
  const { item, assetId } = await findItem(sku);
  const [draft] = await db.select().from(nominationDrafts).where(and(eq(nominationDrafts.id, input.draftId), eq(nominationDrafts.assetId, assetId)));
  if (!draft) throw new TodaysPicksError("That draft isn't this SKU's");
  if (draft.state === "submitted") return { submittedAt: draft.submittedAt!.toISOString(), alreadyRecorded: true };
  if (draft.state !== "draft") throw new TodaysPicksError("Only an open draft can be confirmed");
  if (!input.rightsConfirmed) throw new TodaysPicksError("Confirm you answered the rights question on the form yourself");
  const problems = draftProblems(draft.fields as DraftFields, item);
  if (problems.length) throw new TodaysPicksError(`Fix these first: ${problems.map((p) => p.message).join("; ")}`);

  const now = new Date();
  // Conditional on still being a draft, so two confirmations at once record one submission.
  const updated = await db
    .update(nominationDrafts)
    .set({ state: "submitted", submittedAt: now, submittedBy: actorId, submissionEvidence: input.evidence?.trim() || null, updatedAt: now })
    .where(and(eq(nominationDrafts.id, draft.id), eq(nominationDrafts.state, "draft")))
    .returning({ id: nominationDrafts.id });
  if (updated.length === 0) {
    const [again] = await db.select().from(nominationDrafts).where(eq(nominationDrafts.id, draft.id));
    return { submittedAt: again.submittedAt?.toISOString() ?? now.toISOString(), alreadyRecorded: true };
  }

  const fields = draft.fields as DraftFields;
  const colours = (fields.colour_links ?? "").split(/\n+/).filter(Boolean).length;
  await addEvent(draft.id, "submitted", "submitted", { fields, evidence: input.evidence ?? null, formVersion: draft.formVersion }, actorId);
  await db.insert(teamTaskComments).values({
    taskId: MARKETING_TASK_ID,
    authorId: actorId,
    body:
      `Today's Picks nomination filed for ${fields.final_name} (${sku}), attempt ${draft.attemptNo}: ${fields.item_link}` +
      `${colours ? ` plus ${colours} colour link${colours === 1 ? "" : "s"}` : ""}. Tags: ${fields.tags}.` +
      " Filed on Roblox's form by Arjun; Roblox picks items and only contacts selected creators.",
  });
  await db.insert(auditLog).values({ action: "confirmTodaysPicksNomination", entityType: "asset", entityId: assetId, actorId, payload: { sku, draftId: draft.id, attemptNo: draft.attemptNo } });
  return { submittedAt: now.toISOString(), alreadyRecorded: false };
}

/**
 * Corrects a confirmation recorded by mistake: the attempt goes back to a draft, and the history
 * keeps both the confirmation and the correction with its reason.
 */
export async function undoSubmitted(sku: string, draftId: string, reason: string, actorId: string | null): Promise<void> {
  const { assetId } = await findItem(sku);
  if (reason.trim().length < MIN_RENOMINATION_REASON_CHARS) throw new TodaysPicksError("Say why the confirmation was wrong");
  const updated = await db
    .update(nominationDrafts)
    .set({ state: "draft", submittedAt: null, submittedBy: null, submissionEvidence: null, updatedAt: new Date() })
    .where(and(eq(nominationDrafts.id, draftId), eq(nominationDrafts.assetId, assetId), eq(nominationDrafts.state, "submitted")))
    .returning({ id: nominationDrafts.id });
  if (updated.length === 0) throw new TodaysPicksError("That attempt isn't recorded as submitted");
  await addEvent(draftId, `undo:${Date.now()}`, "submission_undone", { reason: reason.trim() }, actorId);
  await db.insert(auditLog).values({ action: "undoTodaysPicksNomination", entityType: "asset", entityId: assetId, actorId, payload: { sku, draftId, reason: reason.trim() } });
}

/**
 * Opens a new attempt after a submitted one, copying its answers. Re-nominating needs a change
 * (Arjun's policy), so a reason naming it is required.
 */
export async function startRenomination(sku: string, reason: string, actorId: string | null): Promise<string> {
  const { assetId } = await findItem(sku);
  if (reason.trim().length < MIN_RENOMINATION_REASON_CHARS) throw new TodaysPicksError("Say what changed since the last nomination");
  const latest = await latestDraft(assetId);
  if (!latest || latest.state !== "submitted") throw new TodaysPicksError("Re-nominate only after a submitted nomination");
  const [created] = await db
    .insert(nominationDrafts)
    .values({ assetId, attemptNo: latest.attemptNo + 1, formVersion: FORM_VERSION, fields: latest.fields, renominationReason: reason.trim(), createdBy: actorId })
    .onConflictDoNothing()
    .returning({ id: nominationDrafts.id });
  if (!created) throw new TodaysPicksError("A re-nomination is already open");
  await addEvent(created.id, "opened", "renomination_opened", { reason: reason.trim(), after: latest.attemptNo }, actorId);
  return created.id;
}

/** Marks a sheet suggestion used or dismissed. Using one only fills the panel; Arjun still saves. */
export async function setSuggestionStatus(sku: string, suggestionId: string, status: "used" | "dismissed"): Promise<void> {
  const { assetId } = await findItem(sku);
  const updated = await db
    .update(marketingSuggestions)
    .set({ status })
    .where(and(eq(marketingSuggestions.id, suggestionId), eq(marketingSuggestions.assetId, assetId)))
    .returning({ id: marketingSuggestions.id });
  if (updated.length === 0) throw new TodaysPicksError("That suggestion isn't this SKU's");
}

/** Output: per SKU, the latest attempt's state, final name and submission time, for the grid and the sheet. */
export async function nominationSummaries(): Promise<Map<string, { state: string; finalName: string; submittedAt: string | null; attemptNo: number }>> {
  const rows = await db
    .select({ sku: assets.sku, state: nominationDrafts.state, fields: nominationDrafts.fields, submittedAt: nominationDrafts.submittedAt, attemptNo: nominationDrafts.attemptNo })
    .from(nominationDrafts)
    .innerJoin(assets, eq(assets.id, nominationDrafts.assetId))
    .orderBy(desc(nominationDrafts.attemptNo));
  const out = new Map<string, { state: string; finalName: string; submittedAt: string | null; attemptNo: number }>();
  for (const r of rows) {
    if (out.has(r.sku)) continue;
    out.set(r.sku, { state: r.state, finalName: (r.fields as DraftFields).final_name ?? "", submittedAt: r.submittedAt?.toISOString() ?? null, attemptNo: r.attemptNo });
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
