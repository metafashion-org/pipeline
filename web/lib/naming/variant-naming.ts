// Per-variant naming. Every colour version of an item gets its own approved Roblox name, built as
// "<Colour> <approved base name>".
//
// - Before upload (status ready_for_upload): Claude reads the recolour sheet and lists the
//   colourways. Arjun approves the set; the uploader names each listing from it.
// - After upload (live statuses): Claude reads each listing's Roblox thumbnail and says its colour,
//   matching an approved colourway name when there is one. Arjun approves the names; each one is
//   saved on its listing (upload_records.approved_name, variant_label) and Today's Picks checks the
//   listing's Roblox name against it.
//
// The code, not Claude, assembles each name, so the base part is always the approved base name.
// Claude's reading of each image is saved as naming evidence, so the colour words pass the same
// word-by-word evidence check as the base name.

import { createHash, randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { nameEvidence } from "@/lib/db/schema/name_evidence";
import { nameProposals, type VariantCandidate } from "@/lib/db/schema/name_proposals";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { driveThumbnailUrl } from "@/lib/assets/drive-links";
import { LIVE_ON_ROBLOX_STATUSES } from "@/lib/kanban/status-groups";
import { loadNameEvidence } from "@/lib/marketing/name-evidence";
import { conflictOnlyNameWords, unsupportedNameWords } from "@/lib/marketing/nomination-service";
import { isPlaceholderName } from "@/lib/marketing/todays-picks-service";
import { MAX_FINAL_NAME_CHARS } from "@/lib/marketing/nomination-fields";
import { fetchThumbnails } from "@/lib/marketing/roblox-catalog";
import { asPreviewItem, NAMING_MODEL, NamingError, type NamingImage } from "./naming-service";

const VARIANT_EFFORT = "medium";
const VARIANT_MAX_TOKENS = 16000;
// Items per Claude call. A live item sends one thumbnail per listing (six or seven today).
const ITEMS_PER_CALL = 3;
export const MAX_VARIANT_ITEMS_PER_RUN = 24;
const SHEET_IMAGES_PER_ITEM = 2;
const IMAGE_WIDTH_PX = 640;
const IMAGE_FETCH_TIMEOUT_MS = 15_000;
// Longest colour phrase kept, e.g. "Pastel Pink" or "Red and White".
const MAX_COLOUR_CHARS = 24;

const RULES = `You name the colour versions of Roblox accessories. For each item you get its approved base name and images of its colour versions.

For each colour version, give:
- colour: the colour or colour combination a shopper would use for it, 1-3 words in Title Case, e.g. "Red", "Frosty Blue", "Red and White". Name only colours you can see. Two versions of one item must not share a colour name.
- image_note: one short sentence describing what you see in that version's image that shows its colour.

For a recolour sheet, list every colour version shown, left to right, top to bottom.
For listing thumbnails, answer once per thumbnail and echo its listing_id exactly. When approved colourway names are given, reuse the matching colour words.
Never invent a colour you can't see. Answer for every item, using its exact SKU.`;

const VariantResponse = z.object({
  items: z.array(
    z.object({
      sku: z.string(),
      variants: z.array(z.object({ listing_id: z.string(), colour: z.string(), image_note: z.string() })),
    })
  ),
});
type VariantResult = z.infer<typeof VariantResponse>;

export type VariantKind = "colourways" | "listings";

export interface VariantInputItem {
  assetId: string;
  sku: string;
  kind: VariantKind;
  baseName: string;
  approvedColourways: { colour: string; name: string }[];
  // For colourways: recolour sheet Drive ids. For listings: one entry per listing.
  sheetFileIds: string[];
  listings: { id: string; robloxAssetId: string }[];
}

/** One call to the model for a chunk of items. Swappable so tests don't call Claude. */
export type VariantCaller = (items: (VariantInputItem & { images: { label: string; listingId: string; image: NamingImage }[] })[]) => Promise<{ result: VariantResult | null; refusal: string | null; usage: Record<string, number> }>;

/** Input: a colour from Claude and the base name. Output: "<Colour> <Base>", colour in Title Case. */
export function variantName(colour: string, baseName: string): string {
  const clean = colour
    .replace(/[^A-Za-z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COLOUR_CHARS)
    .split(" ")
    .map((w) => (w.toLowerCase() === "and" ? "and" : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
  return `${clean} ${baseName}`.trim();
}

function inputHashOf(item: VariantInputItem): string {
  return createHash("sha256")
    .update(JSON.stringify([NAMING_MODEL, item.kind, item.baseName, item.approvedColourways, item.sheetFileIds, item.listings]))
    .digest("hex")
    .slice(0, 32);
}

async function fetchBytes(url: string): Promise<NamingImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
    const type = (res.headers.get("content-type") ?? "").split(";")[0];
    if (!res.ok || !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) return null;
    return { mediaType: type as NamingImage["mediaType"], base64: Buffer.from(await res.arrayBuffer()).toString("base64") };
  } catch {
    return null;
  }
}

/** Loads the images for one item: its recolour sheet, or one Roblox thumbnail per listing. */
async function defaultLoadImages(item: VariantInputItem): Promise<{ label: string; listingId: string; image: NamingImage }[]> {
  if (item.kind === "colourways") {
    const images = await Promise.all(item.sheetFileIds.slice(0, SHEET_IMAGES_PER_ITEM).map((id) => fetchBytes(driveThumbnailUrl(id, IMAGE_WIDTH_PX))));
    return images.flatMap((image, i) => (image ? [{ label: `recolour sheet ${i + 1}`, listingId: "", image }] : []));
  }
  const urls = await fetchThumbnails(item.listings.map((l) => l.robloxAssetId));
  const out: { label: string; listingId: string; image: NamingImage }[] = [];
  for (const l of item.listings) {
    const url = urls.get(l.robloxAssetId);
    const image = url ? await fetchBytes(url) : null;
    if (image) out.push({ label: `listing ${l.robloxAssetId}`, listingId: l.id, image });
  }
  return out;
}

/** The real caller: one Claude Sonnet 5.5 request per chunk, with structured output. */
export const CLAUDE_VARIANT_CALLER: VariantCaller = async (items) => {
  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const item of items) {
    const colourways = item.approvedColourways.length ? item.approvedColourways.map((c) => c.colour).join(", ") : "none";
    content.push({ type: "text", text: `<item sku="${item.sku}" kind="${item.kind}">\nbase name: ${item.baseName}\napproved colourway colours: ${colourways}\n</item>` });
    for (const img of item.images) {
      content.push({ type: "text", text: item.kind === "listings" ? `<thumbnail listing_id="${img.listingId}">` : "<recolour_sheet>" });
      content.push({ type: "image", source: { type: "base64", media_type: img.image.mediaType, data: img.image.base64 } });
    }
  }
  const response = await client.beta.messages.parse({
    model: NAMING_MODEL,
    max_tokens: VARIANT_MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    // On a safety decline, the API retries on the model Anthropic recommends for that category.
    fallbacks: "default",
    system: [{ type: "text", text: RULES, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { effort: VARIANT_EFFORT, format: betaZodOutputFormat(VariantResponse) },
  });
  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0 };
  if (response.stop_reason === "refusal") return { result: null, refusal: response.stop_details?.explanation ?? "Declined", usage };
  return { result: response.parsed_output ?? null, refusal: null, usage };
};

// Items ready for variant naming: an approved base name, and either a recolour sheet with no
// approved colourways yet (before upload) or live listings without an approved name (after).
async function loadVariantInputs(onlySkus?: string[]): Promise<VariantInputItem[]> {
  const rows = await db
    .select({ id: assets.id, sku: assets.sku, status: assets.currentStatus, baseName: assets.approvedName, recolours: assets.recolorReferenceImages, colourways: assets.approvedColourways })
    .from(assets)
    .where(and(isNotNull(assets.approvedName), isNull(assets.boardHiddenAt), inArray(assets.currentStatus, ["ready_for_upload", ...LIVE_ON_ROBLOX_STATUSES]), ...(onlySkus ? [inArray(assets.sku, onlySkus)] : [])));
  if (rows.length === 0) return [];
  const listings = await db
    .select({ id: uploadRecords.id, assetId: uploadRecords.assetId, robloxAssetId: uploadRecords.robloxAssetId, approvedName: uploadRecords.approvedName })
    .from(uploadRecords)
    .where(inArray(uploadRecords.assetId, rows.map((r) => r.id)))
    .orderBy(asc(uploadRecords.createdAt), asc(uploadRecords.id));
  const out: VariantInputItem[] = [];
  for (const r of rows) {
    const base = { assetId: r.id, sku: r.sku, baseName: r.baseName!, approvedColourways: r.colourways ?? [] };
    if (r.status === "ready_for_upload") {
      const sheetFileIds = ((r.recolours as { externalId?: string }[] | null) ?? []).map((f) => f.externalId).filter((id): id is string => !!id);
      if (sheetFileIds.length && base.approvedColourways.length === 0) out.push({ ...base, kind: "colourways", sheetFileIds, listings: [] });
    } else {
      const unnamed = listings.filter((l) => l.assetId === r.id && !l.approvedName && l.robloxAssetId).map((l) => ({ id: l.id, robloxAssetId: l.robloxAssetId! }));
      if (unnamed.length) out.push({ ...base, kind: "listings", sheetFileIds: [], listings: unnamed });
    }
  }
  return out;
}

/**
 * Suggests a name for every colour version of every item that has an approved base name and still
 * needs variant names. Saves each image reading as naming evidence and the suggestions as a pending
 * proposal. The same inputs are never sent twice.
 *
 * Input: (optional) SKUs, who ran it, and (for tests) the model and image loaders. Output: counts.
 */
export async function runVariantNaming(
  options: { onlySkus?: string[]; actorId?: string | null; caller?: VariantCaller; loadImages?: typeof defaultLoadImages } = {}
): Promise<{ named: number; skipped: number; failed: number }> {
  const caller = options.caller ?? CLAUDE_VARIANT_CALLER;
  if (!options.caller && !process.env.ANTHROPIC_API_KEY) throw new NamingError("ANTHROPIC_API_KEY isn't set in Vercel, so naming can't run");
  const loadImages = options.loadImages ?? defaultLoadImages;
  const inputs = await loadVariantInputs(options.onlySkus);
  const existing = inputs.length
    ? await db.select({ assetId: nameProposals.assetId, inputHash: nameProposals.inputHash }).from(nameProposals).where(inArray(nameProposals.assetId, inputs.map((i) => i.assetId)))
    : [];
  const todo = inputs.filter((i) => !existing.some((e) => e.assetId === i.assetId && e.inputHash === inputHashOf(i))).slice(0, MAX_VARIANT_ITEMS_PER_RUN);
  const result = { named: 0, skipped: inputs.length - todo.length, failed: 0 };
  const batchId = randomUUID();

  for (let i = 0; i < todo.length; i += ITEMS_PER_CALL) {
    const chunk = await Promise.all(todo.slice(i, i + ITEMS_PER_CALL).map(async (item) => ({ ...item, images: await loadImages(item) })));
    let response: Awaited<ReturnType<VariantCaller>>;
    try {
      response = await caller(chunk);
    } catch (err) {
      response = { result: null, refusal: err instanceof Error ? err.message : "Variant naming call failed", usage: {} };
    }
    for (const item of chunk) {
      const answer = response.result?.items.find((r) => r.sku === item.sku);
      const inputHash = inputHashOf(item);
      if (!answer || answer.variants.length === 0) {
        result.failed++;
        await db.insert(nameProposals).values({ assetId: item.assetId, batchId, groupKey: item.kind, kind: item.kind, model: NAMING_MODEL, inputHash, status: "failed", error: response.refusal ?? "No answer for this SKU", usage: response.usage }).onConflictDoNothing();
        continue;
      }
      // For listings, keep only answers for this item's own listings, one per listing.
      const variants = item.kind === "listings" ? item.listings.flatMap((l) => answer.variants.filter((v) => v.listing_id === l.id).slice(0, 1)) : answer.variants;
      const candidates: VariantCandidate[] = variants.map((v) => ({
        ...(item.kind === "listings" ? { listingId: v.listing_id } : {}),
        colour: v.colour.trim(),
        name: variantName(v.colour, item.baseName),
        imageNote: v.image_note.trim(),
      }));
      // Each image reading is evidence for that variant's colour words.
      for (const c of candidates) {
        const listing = item.listings.find((l) => l.id === c.listingId);
        await db
          .insert(nameEvidence)
          .values({
            assetId: item.assetId,
            kind: "image_correspondence",
            sourceRef: listing ? `Listing ${listing.robloxAssetId} thumbnail (AI reading)` : "Recolour sheet (AI reading)",
            location: listing ? `catalog ${listing.robloxAssetId}` : c.colour,
            quote: `${c.colour}: ${c.imageNote}`.slice(0, 1000),
            supports: [],
            confidence: "medium",
            limits: `AI description by ${NAMING_MODEL}; check it against the image before relying on it`,
            enteredBy: NAMING_MODEL,
            rowHash: createHash("sha256").update(`variant:${item.assetId}:${inputHash}:${c.listingId ?? c.colour}`).digest("hex").slice(0, 32),
          })
          .onConflictDoNothing();
      }
      await db.transaction(async (tx) => {
        await tx.update(nameProposals).set({ status: "superseded" }).where(and(eq(nameProposals.assetId, item.assetId), eq(nameProposals.kind, item.kind), eq(nameProposals.status, "pending")));
        await tx.insert(nameProposals).values({ assetId: item.assetId, batchId, groupKey: item.kind, kind: item.kind, model: NAMING_MODEL, inputHash, candidates, usage: response.usage }).onConflictDoNothing();
      });
      result.named++;
    }
  }
  await db.insert(auditLog).values({ action: "runVariantNaming", entityType: "naming", entityId: batchId, actorId: options.actorId ?? null, payload: result });
  return result;
}

export interface VariantView {
  sku: string;
  kind: VariantKind;
  baseName: string;
  proposalId: string;
  createdAt: string;
  status: string;
  error: string | null;
  candidates: (VariantCandidate & { robloxAssetId: string | null; problems: string[] })[];
}

// What stops one variant name from being approved, checked against the item's evidence now.
function variantProblems(name: string, baseName: string, preview: ReturnType<typeof asPreviewItem>): string[] {
  const problems: string[] = [];
  if (name.length > MAX_FINAL_NAME_CHARS) problems.push(`${name.length} characters; the limit is ${MAX_FINAL_NAME_CHARS}`);
  if (!name.toLowerCase().endsWith(` ${baseName.toLowerCase()}`)) problems.push(`Must end with the base name "${baseName}"`);
  if (isPlaceholderName(name)) problems.push("Looks like a placeholder");
  const unsupported = unsupportedNameWords(name, preview);
  if (unsupported.length) problems.push(`Not in any evidence: ${unsupported.join(", ")}`);
  const conflictOnly = conflictOnlyNameWords(name, preview);
  if (conflictOnly.length) problems.push(`Only conflicting evidence: ${conflictOnly.join(", ")}`);
  return problems;
}

async function previewFor(assetId: string, sku: string) {
  const [row] = await db.select({ itemName: assets.itemName, category: assets.category, briefFields: assets.briefFields }).from(assets).where(eq(assets.id, assetId));
  const links = await db
    .select({ artifactId: knowledgeArtifacts.artifactId, title: knowledgeArtifacts.title, description: knowledgeArtifacts.description, tags: knowledgeArtifacts.tags })
    .from(artifactSkuLinks)
    .innerJoin(knowledgeArtifacts, eq(knowledgeArtifacts.id, artifactSkuLinks.artifactId))
    .where(eq(artifactSkuLinks.assetId, assetId));
  const evidence = (await loadNameEvidence([assetId])).get(assetId) ?? [];
  return asPreviewItem(
    { assetId, sku, itemName: row.itemName, category: row.category, trendReasoning: row.briefFields?.trendReasoning?.trim() || null, artifacts: links.map((l) => ({ ...l, tags: l.tags ?? [] })), imageFileIds: [] },
    evidence
  );
}

/** Output: the latest variant proposal of every item that has one, each name checked against the evidence now. */
export async function listVariantNaming(): Promise<VariantView[]> {
  const proposals = await db
    .select({ p: nameProposals, sku: assets.sku, baseName: assets.approvedName })
    .from(nameProposals)
    .innerJoin(assets, eq(assets.id, nameProposals.assetId))
    .where(and(inArray(nameProposals.kind, ["colourways", "listings"]), isNull(assets.boardHiddenAt)))
    .orderBy(desc(nameProposals.createdAt));
  const latest = new Map<string, (typeof proposals)[number]>();
  for (const row of proposals) if (!latest.has(`${row.sku}:${row.p.kind}`)) latest.set(`${row.sku}:${row.p.kind}`, row);
  const listingRows = await db
    .select({ id: uploadRecords.id, robloxAssetId: uploadRecords.robloxAssetId })
    .from(uploadRecords)
    .where(inArray(uploadRecords.assetId, [...new Set([...latest.values()].map((r) => r.p.assetId))].concat(["00000000-0000-0000-0000-000000000000"])));
  const out: VariantView[] = [];
  for (const { p, sku, baseName } of latest.values()) {
    if (!baseName) continue;
    const preview = await previewFor(p.assetId, sku);
    out.push({
      sku,
      kind: p.kind as VariantKind,
      baseName,
      proposalId: p.id,
      createdAt: p.createdAt.toISOString(),
      status: p.status,
      error: p.error,
      candidates: (p.candidates as VariantCandidate[]).map((c) => ({
        ...c,
        robloxAssetId: listingRows.find((l) => l.id === c.listingId)?.robloxAssetId ?? null,
        problems: variantProblems(c.name, baseName, preview),
      })),
    });
  }
  return out.sort((a, b) => a.sku.localeCompare(b.sku));
}

/**
 * Approves the variant names of one item, as suggested or as Arjun edited them. Each name must end
 * with the approved base name, fit the 49-character limit, have evidence for every word, and be
 * unique within the item. Colourways are saved on the asset; listing names on each listing, with
 * the colour as its label.
 *
 * Input: the SKU, the proposal id, the names, who approved. Output: nothing.
 */
export async function approveVariants(
  sku: string,
  input: { proposalId: string; names: { listingId?: string; colour: string; name: string }[] },
  actorId: string | null
): Promise<void> {
  const view = (await listVariantNaming()).find((v) => v.sku === sku && v.proposalId === input.proposalId);
  if (!view || view.status !== "pending") throw new NamingError("That isn't this item's latest open suggestion");
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
  const preview = await previewFor(asset.id, sku);
  const names = input.names.map((n) => ({ ...n, colour: n.colour.trim(), name: n.name.replace(/\s+/g, " ").trim() }));
  if (names.length === 0) throw new NamingError("No names to approve");
  if (new Set(names.map((n) => n.name.toLowerCase())).size !== names.length) throw new NamingError("Two variants share a name");
  for (const n of names) {
    const problems = variantProblems(n.name, view.baseName, preview);
    if (problems.length) throw new NamingError(`${n.name}: ${problems.join("; ")}`);
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    if (view.kind === "colourways") {
      await tx.update(assets).set({ approvedColourways: names.map(({ colour, name }) => ({ colour, name })), updatedAt: now }).where(eq(assets.id, asset.id));
    } else {
      const own = await tx.select({ id: uploadRecords.id }).from(uploadRecords).where(eq(uploadRecords.assetId, asset.id));
      for (const n of names) {
        if (!n.listingId || !own.some((l) => l.id === n.listingId)) throw new NamingError("A name is for a listing that isn't this item's");
        await tx.update(uploadRecords).set({ approvedName: n.name, approvedNameAt: now, approvedNameBy: actorId, variantLabel: n.colour }).where(eq(uploadRecords.id, n.listingId));
      }
    }
    await tx.update(nameProposals).set({ status: "approved", decidedBy: actorId, decidedAt: now }).where(eq(nameProposals.id, input.proposalId));
    await tx.insert(auditLog).values({ action: "approveVariantNames", entityType: "asset", entityId: asset.id, actorId, payload: { sku, kind: view.kind, names } });
  });
}
