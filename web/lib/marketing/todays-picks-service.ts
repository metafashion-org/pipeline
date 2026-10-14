// Stage 1 of Today's Picks: a read-only preview of every live SKU's Roblox listings, Arjun's pick of
// each SKU's main listing, and on-demand checks of what Roblox shows for each listing. Nothing here
// drafts or submits a nomination; a nomination is filed by Arjun on Roblox's own form.

import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { robloxListingChecks } from "@/lib/db/schema/roblox_listing_checks";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { brandGroups } from "@/lib/db/schema/brand_groups";
import { auditLog } from "@/lib/db/schema/audit_log";
import { LIVE_ON_ROBLOX_STATUSES } from "@/lib/kanban/status-groups";
import { fetchListingDetails, fetchThumbnails } from "./roblox-catalog";
import { MAX_FINAL_NAME_CHARS } from "./nomination-fields";
import { loadNameEvidence, type NameEvidenceView } from "./name-evidence";

// One Roblox request per second while checking, well under Roblox's anonymous limits.
const CHECK_GAP_MS = 1000;
// HTTP 429: Roblox asks us to slow down, so the check stops and the rest wait for the next one.
const TOO_MANY_REQUESTS = 429;
// Upload placeholders such as "belt 1", "headband_3", "SantaHat 4": one word, then a number.
const PLACEHOLDER_NAME_PATTERN = /^[a-z]+[\s_-]*\d+$/i;

// Today's Picks is Arjun's own workflow: only his personnel row opens it, not every admin.
export const TODAYS_PICKS_OWNER_EMAIL = "arjun@metafashion.in";

export class TodaysPicksError extends Error {}

/** True only for Arjun's account. getAuthedUser() has already refused inactive people. */
export function isTodaysPicksOwner(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === TODAYS_PICKS_OWNER_EMAIL;
}

export interface ListingCheckView {
  checkedAt: string;
  isForSale: boolean | null;
  priceRobux: number | null;
  robloxName: string | null;
  creatorName: string | null;
  assetTypeId: number | null;
  ourOnSale: boolean;
  error: string | null;
}

export interface PreviewListing {
  id: string;
  url: string;
  robloxAssetId: string | null;
  variantLabel: string | null;
  onSaleAt: string | null;
  isMain: boolean;
  thumbnailUrl: string | null;
  lastCheck: ListingCheckView | null;
}

export interface PreviewItem {
  sku: string;
  itemName: string;
  status: string;
  brandGroup: string | null;
  artifacts: { artifactId: string; title: string; description: string | null; tags: string[] }[];
  // brief_fields.trendReasoning: where the trend came from, written at curation.
  trendReasoning: string | null;
  // Active naming evidence (lib/marketing/name-evidence.ts). Separate from artifacts, which are design-origin links.
  nameEvidence: NameEvidenceView[];
  // The Roblox name Arjun approved before upload (lib/naming/naming-service.ts), if any.
  approvedName: string | null;
  referenceImageCount: number;
  listings: PreviewListing[];
  blockers: string[];
}

/** True for an upload placeholder name like "belt 1" or "headband_3". */
export function isPlaceholderName(name: string): boolean {
  return PLACEHOLDER_NAME_PATTERN.test(name.trim());
}

/**
 * Why a SKU isn't ready for a nomination draft. An empty list means nothing found is blocking; it
 * doesn't mean the nomination is approved.
 *
 * Input: the SKU's listings and artifacts. Output: one plain sentence per blocker.
 */
export function readinessBlockers(item: Pick<PreviewItem, "listings" | "artifacts">): string[] {
  const blockers: string[] = [];
  const { listings } = item;
  if (listings.length === 0) return ["No Roblox links"];

  if (!listings.some((l) => l.isMain)) blockers.push("No main listing chosen");
  if (!listings.some((l) => l.onSaleAt)) blockers.push("No listing ticked on sale");
  if (item.artifacts.length === 0) blockers.push("No linked artifacts");

  const unchecked = listings.filter((l) => !l.lastCheck || l.lastCheck.error).length;
  if (unchecked > 0) blockers.push(`${unchecked} of ${listings.length} listings not checked on Roblox`);

  const mismatched = listings.filter((l) => l.lastCheck && !l.lastCheck.error && l.lastCheck.isForSale !== l.lastCheck.ourOnSale).length;
  if (mismatched > 0) blockers.push(`Our on-sale tick and Roblox disagree on ${mismatched} listings`);

  const names = listings.map((l) => l.lastCheck?.robloxName).filter((n): n is string => !!n);
  const placeholders = names.filter(isPlaceholderName);
  if (placeholders.length > 0) blockers.push(`Placeholder Roblox names: ${placeholders.join(", ")}`);
  const tooLong = names.filter((n) => n.length > MAX_FINAL_NAME_CHARS);
  if (tooLong.length > 0) blockers.push(`${tooLong.length} Roblox names are ${MAX_FINAL_NAME_CHARS + 1}+ characters`);
  const repeated = names.length - new Set(names.map((n) => n.toLowerCase())).size;
  if (repeated > 0) blockers.push(`${repeated + 1} listings share one Roblox name`);

  const unlabelled = listings.filter((l) => !l.variantLabel).length;
  if (listings.length > 1 && unlabelled > 0) blockers.push(`${unlabelled} recolours have no colour label`);
  return blockers;
}

/**
 * Output: every SKU on the board that is live on Roblox and has at least one Roblox link, with its
 * listings (oldest first, each with a thumbnail and the latest Roblox check), artifacts and
 * readiness blockers. Archived cards are left out.
 */
export async function listTodaysPicksPreview(): Promise<PreviewItem[]> {
  const rows = await db
    .select({
      assetId: assets.id,
      sku: assets.sku,
      itemName: assets.itemName,
      status: assets.currentStatus,
      brandGroup: brandGroups.name,
      referenceImages: assets.referenceImages,
      briefFields: assets.briefFields,
      approvedName: assets.approvedName,
      id: uploadRecords.id,
      url: uploadRecords.robloxItemUrl,
      robloxAssetId: uploadRecords.robloxAssetId,
      variantLabel: uploadRecords.variantLabel,
      onSaleAt: uploadRecords.onSaleAt,
      mainAt: uploadRecords.mainAt,
    })
    .from(uploadRecords)
    .innerJoin(assets, eq(assets.id, uploadRecords.assetId))
    .leftJoin(brandGroups, eq(brandGroups.id, assets.brandGroupId))
    .where(and(inArray(assets.currentStatus, LIVE_ON_ROBLOX_STATUSES), isNull(assets.boardHiddenAt)))
    .orderBy(asc(assets.sku), asc(uploadRecords.createdAt), asc(uploadRecords.id));
  if (rows.length === 0) return [];

  const listingIds = rows.map((r) => r.id);
  const assetIds = [...new Set(rows.map((r) => r.assetId))];
  const [checks, artifactRows, thumbnails, evidenceByAsset] = await Promise.all([
    db.select().from(robloxListingChecks).where(inArray(robloxListingChecks.uploadRecordId, listingIds)).orderBy(desc(robloxListingChecks.checkedAt)),
    db
      .select({
        assetId: artifactSkuLinks.assetId,
        artifactId: knowledgeArtifacts.artifactId,
        title: knowledgeArtifacts.title,
        description: knowledgeArtifacts.description,
        tags: knowledgeArtifacts.tags,
      })
      .from(artifactSkuLinks)
      .innerJoin(knowledgeArtifacts, eq(knowledgeArtifacts.id, artifactSkuLinks.artifactId))
      .where(inArray(artifactSkuLinks.assetId, assetIds)),
    fetchThumbnails(rows.map((r) => r.robloxAssetId).filter((id): id is string => !!id)),
    loadNameEvidence(assetIds),
  ]);

  // Checks come newest first, so the first one seen per listing is its latest.
  const latestCheck = new Map<string, ListingCheckView>();
  for (const c of checks) {
    if (latestCheck.has(c.uploadRecordId)) continue;
    latestCheck.set(c.uploadRecordId, {
      checkedAt: c.checkedAt.toISOString(),
      isForSale: c.isForSale,
      priceRobux: c.priceRobux,
      robloxName: c.robloxName,
      creatorName: c.creatorName,
      assetTypeId: c.assetTypeId,
      ourOnSale: c.ourOnSale,
      error: c.error,
    });
  }

  const bySku = new Map<string, PreviewItem>();
  for (const r of rows) {
    const item = bySku.get(r.sku) ?? {
      sku: r.sku,
      itemName: r.itemName,
      status: r.status,
      brandGroup: r.brandGroup,
      artifacts: artifactRows
        .filter((a) => a.assetId === r.assetId)
        .map(({ artifactId, title, description, tags }) => ({ artifactId, title, description, tags: tags ?? [] })),
      trendReasoning: r.briefFields?.trendReasoning?.trim() || null,
      nameEvidence: evidenceByAsset.get(r.assetId) ?? [],
      approvedName: r.approvedName,
      referenceImageCount: Array.isArray(r.referenceImages) ? r.referenceImages.length : 0,
      listings: [],
      blockers: [],
    };
    item.listings.push({
      id: r.id,
      url: r.url,
      robloxAssetId: r.robloxAssetId,
      variantLabel: r.variantLabel,
      onSaleAt: r.onSaleAt?.toISOString() ?? null,
      isMain: !!r.mainAt,
      thumbnailUrl: r.robloxAssetId ? (thumbnails.get(r.robloxAssetId) ?? null) : null,
      lastCheck: latestCheck.get(r.id) ?? null,
    });
    bySku.set(r.sku, item);
  }
  const items = [...bySku.values()];
  for (const item of items) item.blockers = readinessBlockers(item);
  return items;
}

async function findLiveAsset(sku: string) {
  const [asset] = await db.select({ id: assets.id, currentStatus: assets.currentStatus }).from(assets).where(eq(assets.sku, sku)).limit(1);
  if (!asset) throw new TodaysPicksError(`Asset '${sku}' not found`);
  return asset;
}

/**
 * Makes one listing the SKU's main listing, or clears the choice when `linkId` is null. Any other
 * main listing on the SKU is cleared in the same transaction.
 *
 * Input: the SKU, the listing's id or null, and who chose it. Output: nothing. Throws
 * TodaysPicksError when the listing isn't this SKU's.
 */
export async function setMainListing(sku: string, linkId: string | null, actorId: string | null): Promise<void> {
  const asset = await findLiveAsset(sku);
  await db.transaction(async (tx) => {
    if (linkId) {
      const [link] = await tx
        .select({ id: uploadRecords.id })
        .from(uploadRecords)
        .where(and(eq(uploadRecords.id, linkId), eq(uploadRecords.assetId, asset.id)));
      if (!link) throw new TodaysPicksError("That listing isn't on this asset");
      await tx.update(uploadRecords).set({ mainAt: null, mainBy: null }).where(and(eq(uploadRecords.assetId, asset.id), ne(uploadRecords.id, linkId)));
      await tx.update(uploadRecords).set({ mainAt: new Date(), mainBy: actorId }).where(eq(uploadRecords.id, linkId));
    } else {
      await tx.update(uploadRecords).set({ mainAt: null, mainBy: null }).where(eq(uploadRecords.assetId, asset.id));
    }
    await tx.insert(auditLog).values({ action: linkId ? "setMainListing" : "clearMainListing", entityType: "asset", entityId: asset.id, actorId, payload: { sku, linkId } });
  });
}

export interface CheckResult {
  checked: number;
  failed: number;
  stoppedEarly: boolean;
}

/**
 * Asks Roblox what it shows for each of one SKU's listings, one request per second, and stores
 * each answer with our own on-sale tick at that moment. Stops at the first HTTP 429. Never changes
 * the tick itself.
 *
 * Input: the SKU, who asked, and (for tests) a fetch and a wait. Output: counts of what happened.
 */
export async function checkSkuOnRoblox(
  sku: string,
  actorId: string | null,
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<CheckResult> {
  const asset = await findLiveAsset(sku);
  const links = await db
    .select({ id: uploadRecords.id, robloxAssetId: uploadRecords.robloxAssetId, onSaleAt: uploadRecords.onSaleAt })
    .from(uploadRecords)
    .where(eq(uploadRecords.assetId, asset.id))
    .orderBy(asc(uploadRecords.createdAt), asc(uploadRecords.id));

  const result: CheckResult = { checked: 0, failed: 0, stoppedEarly: false };
  for (const [index, link] of links.entries()) {
    if (index > 0) await wait(CHECK_GAP_MS);
    const details = link.robloxAssetId
      ? await fetchListingDetails(link.robloxAssetId, fetchImpl)
      : { httpStatus: null, isForSale: null, priceRobux: null, name: null, assetTypeId: null, creatorName: null, error: "No Roblox id on this link" };
    await db.insert(robloxListingChecks).values({
      uploadRecordId: link.id,
      checkedBy: actorId,
      httpStatus: details.httpStatus,
      isForSale: details.isForSale,
      priceRobux: details.priceRobux,
      robloxName: details.name,
      assetTypeId: details.assetTypeId,
      creatorName: details.creatorName,
      ourOnSale: !!link.onSaleAt,
      error: details.error,
    });
    if (details.error) result.failed++;
    else result.checked++;
    if (details.httpStatus === TOO_MANY_REQUESTS) {
      result.stoppedEarly = true;
      break;
    }
  }
  return result;
}
