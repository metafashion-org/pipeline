// AI naming before upload. Items at Ready for upload are grouped by the artifacts they share and
// sent to Claude a group at a time: the naming guidelines go in a cached system prompt (paid once
// per run), the shared artifact text goes once per group, and each item adds its own details and
// concept images. Claude describes what the images show, then suggests base names, naming the
// source of every word. Arjun picks or edits one and approves it; the approved name is what the
// uploader puts on Roblox and what Today's Picks starts from.
//
// Grounding: Claude's image description is saved as a naming evidence record (kind
// image_correspondence, medium confidence, marked as an AI reading), so the existing word-by-word
// evidence check (lib/marketing/nomination-service.ts) applies to suggested names too. A name with
// a word no artifact, trend note or image description contains can't be approved.
//
// Cost: the same inputs are never sent twice (name_proposals.input_hash), a run names at most
// MAX_ITEMS_PER_RUN items, and nothing runs without ANTHROPIC_API_KEY.

import { createHash, randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { nameEvidence } from "@/lib/db/schema/name_evidence";
import { nameProposals, type NameCandidate } from "@/lib/db/schema/name_proposals";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { driveThumbnailUrl } from "@/lib/assets/drive-links";
import { loadNameEvidence } from "@/lib/marketing/name-evidence";
import { conflictOnlyNameWords, MARKETING_TASK_ID, unsupportedNameWords } from "@/lib/marketing/nomination-service";
import { isPlaceholderName, type PreviewItem } from "@/lib/marketing/todays-picks-service";
import { MAX_FINAL_NAME_CHARS } from "@/lib/marketing/nomination-fields";
import { LIVE_ON_ROBLOX_STATUSES } from "@/lib/kanban/status-groups";

// Claude Sonnet 5.5, as Arjun chose for naming (Sonnet or Haiku credits). Medium effort: naming is
// short, and the evidence check catches what a lower effort misses.
export const NAMING_MODEL = "claude-sonnet-5-5";
const NAMING_EFFORT = "medium";
const NAMING_MAX_TOKENS = 16000;
// Items per Claude call, and per run. Bounds both one response's size and one run's spend.
const ITEMS_PER_CALL = 6;
export const MAX_ITEMS_PER_RUN = 24;
// Concept images sent per item, and the thumbnail width they're fetched at (about 550 input tokens each).
const IMAGES_PER_ITEM = 3;
const IMAGE_WIDTH_PX = 640;
const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const CANDIDATES_PER_ITEM = 3;
const GUIDELINES_KEY = "naming_guidelines";
const MAX_GUIDELINES_CHARS = 8000;
// Items waiting to upload, and live items: a live item's base name is what its listing names build on.
const NAMING_STATUSES = ["ready_for_upload", ...LIVE_ON_ROBLOX_STATUSES];
const IMAGE_EVIDENCE_SOURCE = "Concept images (AI reading)";

export class NamingError extends Error {}

// A starting point for Arjun's own guidelines, which replace it from the Naming page.
export const DEFAULT_GUIDELINES = `Names are for Roblox UGC accessories sold by Meta Fashion. Players find items by searching the Marketplace, so a name is mostly the words a player would type.

- Base name only: no colour. Each colour listing is named "<Colour> <Base name>", e.g. "Red Christmas Bow Parasol".
- Under 50 characters, Title Case, no emoji, no ALL CAPS, no symbols except a hyphen.
- Order: theme or season (if any), the defining motif, then the item type. E.g. "Christmas Santa Head with Glasses", "Tactical Phone Duty Belt".
- Name the item type the way players search it: Backpack, Hat, Headband, Glasses, Belt, Necklace.
- No brand, franchise, game or creator names, and nothing Roblox's Marketplace policy forbids.
- No filler ("cute", "aesthetic", "UGC", "item") unless the evidence shows it is a search term for this trend.
- Don't repeat a word.`;

const RULES = `You suggest base names for Roblox accessories. Work only from the evidence given: artifact text, trend notes, and the concept images.

For each item:
1. image_notes: describe only what the concept images show - item type, shape, motifs, materials, notable details. No guesses about use or origin. Write "No images" if none were given.
2. candidates: up to ${CANDIDATES_PER_ITEM} base names, best first, following the naming guidelines. Each must be under 50 characters.
3. For every word of every name, give its source: "artifact:<ID>" for an artifact's text, "trend" for the item's trend note, or "images" for your image_notes. Every meaningful word must appear in that source. If a word can't be sourced, don't use it.

The working title is an internal, exploratory label. Use it to understand which item is meant, never as a source of words.
Answer for every item you were given, using its exact SKU.`;

const NamingResponse = z.object({
  items: z.array(
    z.object({
      sku: z.string(),
      image_notes: z.string(),
      candidates: z.array(z.object({ name: z.string(), why: z.string(), words: z.array(z.object({ word: z.string(), source: z.string() })) })),
    })
  ),
});
export type NamingResult = z.infer<typeof NamingResponse>;

export interface NamingImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  base64: string;
}

export interface NamingInputItem {
  assetId: string;
  sku: string;
  itemName: string;
  category: string | null;
  trendReasoning: string | null;
  artifacts: PreviewItem["artifacts"];
  imageFileIds: string[];
}

/** One call to the model. Swappable so tests don't call Claude. */
export type NamingCaller = (input: { guidelines: string; groupKey: string; items: (NamingInputItem & { images: NamingImage[] })[] }) => Promise<{ result: NamingResult | null; refusal: string | null; usage: Record<string, number> }>;

/** Output: Arjun's naming guidelines, or the default draft until he saves his own. */
export async function getGuidelines(): Promise<{ text: string; isDefault: boolean }> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, GUIDELINES_KEY)).limit(1);
  const text = typeof row?.value === "string" ? row.value : null;
  return text ? { text, isDefault: false } : { text: DEFAULT_GUIDELINES, isDefault: true };
}

/** Saves Arjun's naming guidelines. Changing them makes every item eligible for new suggestions. */
export async function setGuidelines(text: string, actorId: string | null): Promise<void> {
  const clean = text.trim();
  if (!clean || clean.length > MAX_GUIDELINES_CHARS) throw new NamingError(`Guidelines must be 1-${MAX_GUIDELINES_CHARS} characters`);
  await db
    .insert(appSettings)
    .values({ key: GUIDELINES_KEY, value: clean, updatedBy: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: clean, updatedBy: actorId, updatedAt: new Date() } });
  await db.insert(auditLog).values({ action: "setNamingGuidelines", entityType: "naming", entityId: null, actorId, payload: { chars: clean.length } });
}

/** Input: assets. Output: the group each belongs to: its sorted artifact ids, or "none". */
export function groupKeyOf(item: Pick<NamingInputItem, "artifacts">): string {
  const ids = item.artifacts.map((a) => a.artifactId).sort();
  return ids.length ? ids.join(",") : "none";
}

/** A hash of everything sent to Claude for one item, so unchanged inputs aren't named twice. */
export function inputHashOf(item: NamingInputItem, guidelines: string): string {
  return createHash("sha256")
    .update(JSON.stringify([NAMING_MODEL, guidelines, item.itemName, item.category, item.trendReasoning, item.artifacts, item.imageFileIds.slice(0, IMAGES_PER_ITEM)]))
    .digest("hex")
    .slice(0, 32);
}

// Loads the assets waiting for a name, with their artifacts, trend note and concept image ids.
async function loadNamingInputs(onlySkus?: string[]): Promise<NamingInputItem[]> {
  const rows = await db
    .select({ id: assets.id, sku: assets.sku, itemName: assets.itemName, category: assets.category, briefFields: assets.briefFields, referenceImages: assets.referenceImages })
    .from(assets)
    .where(and(inArray(assets.currentStatus, NAMING_STATUSES), isNull(assets.boardHiddenAt), isNull(assets.approvedName), ...(onlySkus ? [inArray(assets.sku, onlySkus)] : [])));
  if (rows.length === 0) return [];
  const links = await db
    .select({ assetId: artifactSkuLinks.assetId, artifactId: knowledgeArtifacts.artifactId, title: knowledgeArtifacts.title, description: knowledgeArtifacts.description, tags: knowledgeArtifacts.tags })
    .from(artifactSkuLinks)
    .innerJoin(knowledgeArtifacts, eq(knowledgeArtifacts.id, artifactSkuLinks.artifactId))
    .where(inArray(artifactSkuLinks.assetId, rows.map((r) => r.id)));
  return rows.map((r) => ({
    assetId: r.id,
    sku: r.sku,
    itemName: r.itemName,
    category: r.category,
    trendReasoning: r.briefFields?.trendReasoning?.trim() || null,
    artifacts: links.filter((l) => l.assetId === r.id).map(({ artifactId, title, description, tags }) => ({ artifactId, title, description, tags: tags ?? [] })),
    imageFileIds: ((r.referenceImages as { externalId?: string }[] | null) ?? []).map((f) => f.externalId).filter((id): id is string => !!id),
  }));
}

async function fetchImage(fileId: string): Promise<NamingImage | null> {
  try {
    const res = await fetch(driveThumbnailUrl(fileId, IMAGE_WIDTH_PX), { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
    const type = (res.headers.get("content-type") ?? "").split(";")[0];
    if (!res.ok || !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) return null;
    return { mediaType: type as NamingImage["mediaType"], base64: Buffer.from(await res.arrayBuffer()).toString("base64") };
  } catch {
    return null;
  }
}

/** The real caller: one Claude Sonnet 5.5 request per group chunk, with structured output. */
export const CLAUDE_NAMING_CALLER: NamingCaller = async ({ guidelines, groupKey, items }) => {
  const client = new Anthropic();
  const shared = items[0]?.artifacts.length
    ? items[0].artifacts.map((a) => `<artifact id="${a.artifactId}">\n${[a.title, a.description, a.tags.length ? `tags: ${a.tags.join(", ")}` : ""].filter(Boolean).join("\n")}\n</artifact>`).join("\n")
    : "No artifacts are linked to these items.";
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: `<shared_artifacts group="${groupKey}">\n${shared}\n</shared_artifacts>` }];
  for (const item of items) {
    content.push({
      type: "text",
      text: `<item sku="${item.sku}">\nworking title (exploratory, not a word source): ${item.itemName}\ncategory: ${item.category ?? "unknown"}\ntrend note: ${item.trendReasoning ?? "none"}\nconcept images attached below: ${item.images.length}\n</item>`,
    });
    for (const image of item.images) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
  }
  const response = await client.beta.messages.parse({
    model: NAMING_MODEL,
    max_tokens: NAMING_MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    // On a safety decline, the API retries on the model Anthropic recommends for that category.
    fallbacks: "default",
    system: [{ type: "text", text: `${RULES}\n\n<naming_guidelines>\n${guidelines}\n</naming_guidelines>`, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { effort: NAMING_EFFORT, format: betaZodOutputFormat(NamingResponse) },
  });
  const usage = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  };
  if (response.stop_reason === "refusal") return { result: null, refusal: response.stop_details?.explanation ?? "Declined", usage };
  return { result: response.parsed_output ?? null, refusal: null, usage };
};

export function asPreviewItem(item: NamingInputItem, evidence: PreviewItem["nameEvidence"]): PreviewItem {
  return { sku: item.sku, itemName: item.itemName, status: "ready_for_upload", brandGroup: null, artifacts: item.artifacts, trendReasoning: item.trendReasoning, nameEvidence: evidence, approvedName: null, referenceImageCount: item.imageFileIds.length, listings: [], blockers: [] };
}

/**
 * Names the items waiting at Ready for upload that have no approved name and no suggestions for
 * their current inputs. Groups them by shared artifacts, calls Claude per chunk of ITEMS_PER_CALL,
 * saves the image reading as naming evidence and the suggestions as a pending proposal, then posts
 * one update on the private marketing task listing what's waiting.
 *
 * Input: (optional) SKUs to limit the run to, who ran it, and (for tests) the model and image
 * fetchers. Output: counts of what happened.
 */
export async function runNaming(
  options: { onlySkus?: string[]; actorId?: string | null; caller?: NamingCaller; loadImage?: (fileId: string) => Promise<NamingImage | null> } = {}
): Promise<{ named: number; skipped: number; failed: number; batchId: string | null }> {
  const caller = options.caller ?? CLAUDE_NAMING_CALLER;
  if (!options.caller && !process.env.ANTHROPIC_API_KEY) throw new NamingError("ANTHROPIC_API_KEY isn't set in Vercel, so naming can't run");
  const loadImage = options.loadImage ?? fetchImage;
  const { text: guidelines } = await getGuidelines();
  const inputs = await loadNamingInputs(options.onlySkus);
  const existing = inputs.length
    ? await db.select({ assetId: nameProposals.assetId, inputHash: nameProposals.inputHash }).from(nameProposals).where(and(inArray(nameProposals.assetId, inputs.map((i) => i.assetId)), eq(nameProposals.kind, "base")))
    : [];
  const todo = inputs.filter((i) => !existing.some((e) => e.assetId === i.assetId && e.inputHash === inputHashOf(i, guidelines))).slice(0, MAX_ITEMS_PER_RUN);
  const result = { named: 0, skipped: inputs.length - todo.length, failed: 0, batchId: null as string | null };
  if (todo.length === 0) return result;

  const batchId = randomUUID();
  result.batchId = batchId;
  const groups = new Map<string, NamingInputItem[]>();
  for (const item of todo) groups.set(groupKeyOf(item), [...(groups.get(groupKeyOf(item)) ?? []), item]);

  const namedSkus: string[] = [];
  for (const [groupKey, items] of groups) {
    for (let i = 0; i < items.length; i += ITEMS_PER_CALL) {
      const chunk = items.slice(i, i + ITEMS_PER_CALL);
      const withImages = await Promise.all(chunk.map(async (item) => ({ ...item, images: (await Promise.all(item.imageFileIds.slice(0, IMAGES_PER_ITEM).map(loadImage))).filter((img): img is NamingImage => !!img) })));
      let response: Awaited<ReturnType<NamingCaller>>;
      try {
        response = await caller({ guidelines, groupKey, items: withImages });
      } catch (err) {
        response = { result: null, refusal: err instanceof Error ? err.message : "Naming call failed", usage: {} };
      }
      for (const item of withImages) {
        const answer = response.result?.items.find((r) => r.sku === item.sku);
        const inputHash = inputHashOf(item, guidelines);
        if (!answer) {
          result.failed++;
          await db
            .insert(nameProposals)
            .values({ assetId: item.assetId, batchId, groupKey, model: NAMING_MODEL, inputHash, status: "failed", error: response.refusal ?? "No answer for this SKU", usage: response.usage })
            .onConflictDoNothing();
          continue;
        }
        // The image reading becomes evidence, clearly marked as Claude's, so names can cite it.
        if (item.images.length > 0 && answer.image_notes.trim()) {
          await db
            .insert(nameEvidence)
            .values({
              assetId: item.assetId,
              kind: "image_correspondence",
              sourceRef: IMAGE_EVIDENCE_SOURCE,
              location: `${item.images.length} concept image${item.images.length === 1 ? "" : "s"}`,
              quote: answer.image_notes.trim().slice(0, 1000),
              supports: [],
              confidence: "medium",
              limits: `AI description by ${NAMING_MODEL}; check it against the images before relying on it`,
              enteredBy: NAMING_MODEL,
              rowHash: createHash("sha256").update(`naming:${item.assetId}:${inputHash}`).digest("hex").slice(0, 32),
            })
            .onConflictDoNothing();
        }
        const candidates: NameCandidate[] = answer.candidates
          .slice(0, CANDIDATES_PER_ITEM)
          .map((c) => ({ name: c.name.trim(), why: c.why.trim(), words: c.words }))
          .filter((c) => c.name && c.name.length <= MAX_FINAL_NAME_CHARS && !isPlaceholderName(c.name));
        await db.transaction(async (tx) => {
          await tx.update(nameProposals).set({ status: "superseded" }).where(and(eq(nameProposals.assetId, item.assetId), eq(nameProposals.kind, "base"), eq(nameProposals.status, "pending")));
          await tx
            .insert(nameProposals)
            .values({ assetId: item.assetId, batchId, groupKey, model: NAMING_MODEL, inputHash, candidates, imageNotes: answer.image_notes.trim(), usage: response.usage })
            .onConflictDoNothing();
        });
        result.named++;
        namedSkus.push(item.sku);
      }
    }
  }
  await db.insert(auditLog).values({ action: "runNaming", entityType: "naming", entityId: batchId, actorId: options.actorId ?? null, payload: { ...result, skus: namedSkus } });
  if (namedSkus.length) {
    await db.insert(teamTaskComments).values({
      taskId: MARKETING_TASK_ID,
      authorId: options.actorId ?? null,
      body: `Name suggestions are ready for ${namedSkus.length} item${namedSkus.length === 1 ? "" : "s"} waiting to upload: ${namedSkus.join(", ")}. Pick and approve a name on the Naming page before upload.`,
    });
  }
  return result;
}

export interface NamingView {
  sku: string;
  itemName: string;
  category: string | null;
  status: string;
  approvedName: string | null;
  imageFileIds: string[];
  evidenceCount: number;
  proposal: { id: string; status: string; createdAt: string; imageNotes: string | null; error: string | null; candidates: (NameCandidate & { unsupported: string[]; conflictOnly: string[] })[] } | null;
}

/**
 * Output: every item waiting at Ready for upload (and any with an undecided proposal), with its
 * latest suggestions checked word by word against the evidence as it stands now.
 */
export async function listNaming(): Promise<NamingView[]> {
  const rows = await db
    .select({ id: assets.id, sku: assets.sku, itemName: assets.itemName, category: assets.category, status: assets.currentStatus, approvedName: assets.approvedName, briefFields: assets.briefFields, referenceImages: assets.referenceImages })
    .from(assets)
    .where(and(inArray(assets.currentStatus, NAMING_STATUSES), isNull(assets.boardHiddenAt)))
    .orderBy(assets.sku);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [proposals, evidence, links] = await Promise.all([
    db.select().from(nameProposals).where(and(inArray(nameProposals.assetId, ids), eq(nameProposals.kind, "base"))).orderBy(desc(nameProposals.createdAt)),
    loadNameEvidence(ids),
    db
      .select({ assetId: artifactSkuLinks.assetId, artifactId: knowledgeArtifacts.artifactId, title: knowledgeArtifacts.title, description: knowledgeArtifacts.description, tags: knowledgeArtifacts.tags })
      .from(artifactSkuLinks)
      .innerJoin(knowledgeArtifacts, eq(knowledgeArtifacts.id, artifactSkuLinks.artifactId))
      .where(inArray(artifactSkuLinks.assetId, ids)),
  ]);
  return rows.map((r) => {
    const input: NamingInputItem = {
      assetId: r.id,
      sku: r.sku,
      itemName: r.itemName,
      category: r.category,
      trendReasoning: r.briefFields?.trendReasoning?.trim() || null,
      artifacts: links.filter((l) => l.assetId === r.id).map(({ artifactId, title, description, tags }) => ({ artifactId, title, description, tags: tags ?? [] })),
      imageFileIds: ((r.referenceImages as { externalId?: string }[] | null) ?? []).map((f) => f.externalId).filter((id): id is string => !!id),
    };
    const preview = asPreviewItem(input, evidence.get(r.id) ?? []);
    const latest = proposals.find((p) => p.assetId === r.id) ?? null;
    return {
      sku: r.sku,
      itemName: r.itemName,
      category: r.category,
      status: r.status,
      approvedName: r.approvedName,
      imageFileIds: input.imageFileIds.slice(0, IMAGES_PER_ITEM),
      evidenceCount: preview.nameEvidence.length + preview.artifacts.length + (preview.trendReasoning ? 1 : 0),
      proposal: latest && {
        id: latest.id,
        status: latest.status,
        createdAt: latest.createdAt.toISOString(),
        imageNotes: latest.imageNotes,
        error: latest.error,
        candidates: (latest.candidates as NameCandidate[]).map((c) => ({ ...c, unsupported: unsupportedNameWords(c.name, preview), conflictOnly: conflictOnlyNameWords(c.name, preview) })),
      },
    };
  });
}

/**
 * Approves a base name for an item: one of the suggestions, Arjun's edit of one, or a name he types
 * with no suggestion (proposalId null), e.g. a name approved in an earlier review. Every word must
 * be backed by the item's evidence (none only by conflicting evidence), under 50 characters, and
 * not a placeholder. Saves it as the item's approved base name and closes the proposal if any.
 *
 * Input: the SKU, the proposal id or null, the name, who approved. Output: nothing.
 */
export async function approveName(sku: string, input: { proposalId: string | null; name: string }, actorId: string | null): Promise<void> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name || name.length > MAX_FINAL_NAME_CHARS) throw new NamingError(`A name is 1-${MAX_FINAL_NAME_CHARS} characters`);
  if (isPlaceholderName(name)) throw new NamingError("That looks like a placeholder name");
  const item = (await listNaming()).find((v) => v.sku === sku);
  if (!item) throw new NamingError(`${sku} isn't waiting to upload or live`);
  if (input.proposalId && item.proposal?.id !== input.proposalId) throw new NamingError("That suggestion isn't this item's latest");
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
  const inputs = await loadNamingInputs([sku]);
  const evidence = (await loadNameEvidence([asset.id])).get(asset.id) ?? [];
  const preview = asPreviewItem(inputs[0] ?? { assetId: asset.id, sku, itemName: item.itemName, category: item.category, trendReasoning: null, artifacts: [], imageFileIds: [] }, evidence);
  const unsupported = unsupportedNameWords(name, preview);
  if (unsupported.length) throw new NamingError(`Not in any evidence for this item: ${unsupported.join(", ")}`);
  const conflictOnly = conflictOnlyNameWords(name, preview);
  if (conflictOnly.length) throw new NamingError(`Only conflicting evidence supports: ${conflictOnly.join(", ")}`);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(assets).set({ approvedName: name, approvedNameAt: now, approvedNameBy: actorId, updatedAt: now }).where(eq(assets.id, asset.id));
    if (input.proposalId) await tx.update(nameProposals).set({ status: "approved", chosenName: name, decidedBy: actorId, decidedAt: now }).where(eq(nameProposals.id, input.proposalId));
    await tx.insert(auditLog).values({ action: "approveName", entityType: "asset", entityId: asset.id, actorId, payload: { sku, name, proposalId: input.proposalId } });
  });
}
