// Today's Picks filing, the simple way. For each live item the Kanban works out the form answers
// from what it already knows and checks readiness automatically:
// - the name is the one approved on the Naming page (the listing's own variant name for the main
//   listing, else the base name);
// - the main listing must be on sale and already carry that name on Roblox (checked, not asked);
// - the answers come from the item's data (link, item type, tags, colour links, season), with any
//   edits Arjun saved.
// Username and email are set once at the top of the page and used for every filing.
// Whoever fills the form (Arjun, or his assistant from the private sheet) marks it filed; that one
// action records the nomination, logs it on the Marketing tracker and posts on the marketing task.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { marketingUpdates } from "@/lib/db/schema/marketing_updates";
import { nominationDrafts, nominationEvents } from "@/lib/db/schema/nomination_drafts";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { FIELD_LIMITS, FORM_VERSION, ITEM_TYPES, type DraftFields } from "./nomination-fields";
import { MARKETING_TASK_ID, NOMINATION_EMAIL, NOMINATION_USERNAME, proposeDraft } from "./nomination-service";
import { listTodaysPicksPreview, TodaysPicksError, type PreviewItem } from "./todays-picks-service";

const OWNER_DETAILS_KEY = "todays_picks_owner_details";
const MAX_NOTE_CHARS = 300;
// How a filing shows on the Marketing tracker.
const MARKETING_PLATFORM = "Roblox Today's Picks";
const MARKETING_CAMPAIGN = "Today's Picks";
const MARKETING_STATUS = "posted";

export interface OwnerDetails {
  username: string;
  email: string;
}

/** Output: the Roblox username and email used on every filing. */
export async function getOwnerDetails(): Promise<OwnerDetails> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, OWNER_DETAILS_KEY)).limit(1);
  const value = (row?.value ?? {}) as Partial<OwnerDetails>;
  return { username: value.username || NOMINATION_USERNAME, email: value.email || NOMINATION_EMAIL };
}

/** Changes the username and email for every filing from now on. */
export async function setOwnerDetails(details: OwnerDetails, actorId: string | null): Promise<OwnerDetails> {
  const clean = { username: details.username.trim(), email: details.email.trim() };
  if (!clean.username || !/^\S+@\S+\.\S+$/.test(clean.email)) throw new TodaysPicksError("Give a Roblox username and a valid email");
  await db
    .insert(appSettings)
    .values({ key: OWNER_DETAILS_KEY, value: clean, updatedBy: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: clean, updatedBy: actorId, updatedAt: new Date() } });
  await db.insert(auditLog).values({ action: "setTodaysPicksOwnerDetails", entityType: "todays_picks", entityId: null, actorId, payload: {} });
  return clean;
}

export interface FilingPackage {
  sku: string;
  itemName: string;
  name: string | null;
  // The form's item-page answers, in the form's order.
  fields: { item_link: string; item_type: string; tags: string; audience: string; colour_links: string; season: string; extra_info: string; theme: string };
  checklist: { label: string; ok: boolean }[];
  ready: boolean;
  filed: { at: string; by: string; note: string | null } | null;
}

/**
 * The form answers and the automatic readiness checklist for one item.
 *
 * Input: the item, its saved answers (if Arjun edited any), and its filing (if filed). Output: the package.
 */
export function filingPackage(item: PreviewItem, saved: DraftFields, filed: FilingPackage["filed"]): FilingPackage {
  const { proposed } = proposeDraft(item, item.approvedName ?? "");
  const main = item.listings.find((l) => l.isMain);
  const name = main?.approvedName ?? item.approvedName ?? null;
  const pick = (f: keyof DraftFields) => (saved[f] ?? proposed[f] ?? "").trim();
  const fields = {
    item_link: main?.url ?? "",
    item_type: pick("item_type"),
    tags: pick("tags"),
    audience: pick("audience"),
    colour_links: proposed.colour_links ?? "",
    season: pick("season"),
    extra_info: pick("extra_info"),
    theme: pick("theme"),
  };
  const robloxName = main?.lastCheck?.robloxName?.trim() ?? null;
  const checklist = [
    { label: name ? `Name approved: ${name}` : "Approve a name on the Naming page", ok: !!name },
    { label: main ? "Main listing chosen" : "Choose a main listing", ok: !!main },
    {
      label: !main?.lastCheck ? "Check the main listing on Roblox" : main.lastCheck.isForSale ? "Main listing on sale" : "Main listing is off sale on Roblox",
      ok: !!main?.lastCheck?.isForSale,
    },
    {
      label: !name || !robloxName ? "Roblox name not checked yet" : robloxName.toLowerCase() === name.toLowerCase() ? "Roblox name matches" : `Rename on Roblox: "${robloxName}" → "${name}"`,
      ok: !!name && !!robloxName && robloxName.toLowerCase() === name.toLowerCase(),
    },
    { label: ITEM_TYPES.includes(fields.item_type as (typeof ITEM_TYPES)[number]) ? `Item type: ${fields.item_type}` : "Item type unknown: check the main listing on Roblox", ok: ITEM_TYPES.includes(fields.item_type as (typeof ITEM_TYPES)[number]) },
    { label: !fields.tags ? "Add tags" : fields.tags.length > FIELD_LIMITS.tags ? `Tags are ${fields.tags.length}/${FIELD_LIMITS.tags} characters` : "Tags", ok: !!fields.tags && fields.tags.length <= FIELD_LIMITS.tags },
  ];
  for (const f of ["season", "extra_info", "theme"] as const) {
    if (fields[f].length > FIELD_LIMITS[f]) checklist.push({ label: `${f.replace("_", " ")} is ${fields[f].length}/${FIELD_LIMITS[f]} characters`, ok: false });
  }
  return { sku: item.sku, itemName: item.itemName, name, fields, checklist, ready: checklist.every((c) => c.ok), filed };
}

async function latestDraftOf(assetId: string) {
  const [row] = await db.select().from(nominationDrafts).where(eq(nominationDrafts.assetId, assetId)).orderBy(desc(nominationDrafts.attemptNo)).limit(1);
  return row ?? null;
}

/** Output: the filing package of every live item, ready ones first, filed ones last. */
export async function listFilings(): Promise<FilingPackage[]> {
  const items = await listTodaysPicksPreview();
  const rows = await db
    .select({ sku: assets.sku, state: nominationDrafts.state, fields: nominationDrafts.fields, submittedAt: nominationDrafts.submittedAt, evidence: nominationDrafts.submissionEvidence, attemptNo: nominationDrafts.attemptNo })
    .from(nominationDrafts)
    .innerJoin(assets, eq(assets.id, nominationDrafts.assetId))
    .orderBy(desc(nominationDrafts.attemptNo));
  const packages = items.map((item) => {
    const draft = rows.find((r) => r.sku === item.sku);
    const filed = draft?.state === "submitted" && draft.submittedAt ? { at: draft.submittedAt.toISOString(), by: (draft.evidence ?? "").split(":")[0] || "Arjun", note: draft.evidence } : null;
    return filingPackage(item, (draft?.fields ?? {}) as DraftFields, filed);
  });
  const rank = (p: FilingPackage) => (p.filed ? 2 : p.ready ? 0 : 1);
  return packages.sort((a, b) => rank(a) - rank(b) || a.sku.localeCompare(b.sku));
}

/**
 * Records that this item's Today's Picks form was filed. One transaction: the nomination record,
 * its history event, a "Roblox Today's Picks" entry on the Marketing tracker, the audit row and one
 * comment on the marketing task. Filing the same item again records nothing new.
 *
 * Input: the SKU, who filed it ("Arjun" or the assistant's name) and an optional note, and who
 * recorded it. Output: whether it was already filed.
 */
export async function markFiled(sku: string, input: { by: string; note?: string | null }, actorId: string | null): Promise<{ alreadyFiled: boolean }> {
  const item = (await listTodaysPicksPreview()).find((i) => i.sku === sku);
  if (!item) throw new TodaysPicksError(`${sku} isn't a live item with Roblox links`);
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
  const by = input.by.trim().slice(0, 60) || "Arjun";
  const note = input.note?.trim().slice(0, MAX_NOTE_CHARS) || null;
  const existing = await latestDraftOf(asset.id);
  const pkg = filingPackage(item, (existing?.fields ?? {}) as DraftFields, null);
  const now = new Date();
  return db.transaction(async (tx) => {
    // Lock the item's draft (or create attempt 1) so two "filed" clicks record one filing.
    let [draft] = existing ? await tx.select().from(nominationDrafts).where(eq(nominationDrafts.id, existing.id)).for("update") : [];
    if (draft?.state === "submitted") return { alreadyFiled: true };
    const fields: DraftFields = { final_name: pkg.name ?? "", ...pkg.fields };
    if (!draft) {
      [draft] = await tx.insert(nominationDrafts).values({ assetId: asset.id, attemptNo: 1, formVersion: FORM_VERSION, fields }).onConflictDoNothing().returning();
      if (!draft) return { alreadyFiled: true };
    }
    const updated = await tx
      .update(nominationDrafts)
      .set({ state: "submitted", fields, submittedAt: now, submittedBy: actorId, submissionEvidence: `${by}${note ? `: ${note}` : ""}`, updatedAt: now })
      .where(and(eq(nominationDrafts.id, draft.id), eq(nominationDrafts.state, "draft")))
      .returning({ id: nominationDrafts.id });
    if (updated.length === 0) return { alreadyFiled: true };
    await tx.insert(nominationEvents).values({ draftId: draft.id, eventKey: `filed:${now.getTime()}`, kind: "filed", payload: { by, note, fields, readyWhenFiled: pkg.ready, checklist: pkg.checklist }, actorId });
    await tx.insert(marketingUpdates).values({
      assetId: asset.id,
      campaign: MARKETING_CAMPAIGN,
      platform: MARKETING_PLATFORM,
      postType: "Nomination",
      postUrl: pkg.fields.item_link || null,
      postedAt: now,
      marketingStatus: MARKETING_STATUS,
      notes: `Filed by ${by}${note ? ` (${note})` : ""}. Roblox picks items and only contacts selected creators.`,
      responsiblePersonId: actorId,
    });
    await tx.update(assets).set({ marketingStatus: MARKETING_STATUS, lastMarketingUpdate: now, updatedAt: now }).where(eq(assets.id, asset.id));
    await tx.insert(auditLog).values({ action: "markTodaysPicksFiled", entityType: "asset", entityId: asset.id, actorId, payload: { sku, by, note } });
    await tx.insert(teamTaskComments).values({
      taskId: MARKETING_TASK_ID,
      authorId: actorId,
      body: `Today's Picks filed for ${pkg.name ?? sku} (${sku}) by ${by}: ${pkg.fields.item_link}.${note ? ` ${note}` : ""}`,
    });
    return { alreadyFiled: false };
  });
}
