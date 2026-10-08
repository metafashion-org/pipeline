// An asset's Roblox links, one per uploaded recolour, and putting them on sale. The uploader adds
// links on the Upload queue (publisher-service.ts) and can add one for a new recolour at any time
// after that. Arjun ticks which links are on sale, on the card or on the Marketing page. Being on
// sale is a property of each recolour, not a board column: an uploaded recolour can stay off sale.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { auditLog } from "@/lib/db/schema/audit_log";
import { LIVE_ON_ROBLOX_STATUSES } from "@/lib/kanban/status-groups";
import { parseRobloxCatalogLink } from "./roblox-links";

const MAX_VARIANT_LABEL_CHARS = 80;

export class OnSaleError extends Error {}

export interface RobloxLinkView {
  id: string;
  url: string;
  robloxAssetId: string | null;
  variantLabel: string | null;
  onSaleAt: Date | null;
  createdAt: Date;
}

/** Only an admin (Arjun) puts recolours on sale. */
export function canPutOnSale(roles: string[]): boolean {
  return roles.some((role) => role.toLowerCase() === "admin");
}

async function findAsset(sku: string) {
  const [asset] = await db.select({ id: assets.id, currentStatus: assets.currentStatus }).from(assets).where(eq(assets.sku, sku)).limit(1);
  if (!asset) throw new OnSaleError(`Asset '${sku}' not found`);
  return asset;
}

/**
 * Input: an asset's SKU. Output: its Roblox links, oldest first, so the first upload is Link 1.
 */
export async function listRobloxLinks(sku: string): Promise<RobloxLinkView[]> {
  const asset = await findAsset(sku);
  return db
    .select({
      id: uploadRecords.id,
      url: uploadRecords.robloxItemUrl,
      robloxAssetId: uploadRecords.robloxAssetId,
      variantLabel: uploadRecords.variantLabel,
      onSaleAt: uploadRecords.onSaleAt,
      createdAt: uploadRecords.createdAt,
    })
    .from(uploadRecords)
    .where(eq(uploadRecords.assetId, asset.id))
    .orderBy(asc(uploadRecords.createdAt), asc(uploadRecords.id));
}

/**
 * Adds the Roblox link of a recolour uploaded after the asset first went live. The asset keeps its
 * status; the new link starts off sale.
 *
 * Input: the SKU, the catalog link, an optional recolour name and who added it.
 * Output: the new link. Throws OnSaleError for a bad link, a repeat, or an asset not yet on Roblox.
 */
export async function addRobloxLink(sku: string, rawUrl: string, variantLabel: string | null, actorId: string | null): Promise<RobloxLinkView> {
  const asset = await findAsset(sku);
  if (!LIVE_ON_ROBLOX_STATUSES.includes(asset.currentStatus)) {
    throw new OnSaleError("Add the first Roblox links on the Upload queue. This box is for recolours uploaded later.");
  }
  const parsed = parseRobloxCatalogLink(rawUrl);
  if (typeof parsed === "string") throw new OnSaleError(parsed);
  const existing = await listRobloxLinks(sku);
  if (existing.some((link) => link.robloxAssetId === parsed.assetId)) throw new OnSaleError("That Roblox item is already linked to this asset");

  const label = variantLabel?.trim().slice(0, MAX_VARIANT_LABEL_CHARS) || null;
  const [row] = await db
    .insert(uploadRecords)
    .values({ assetId: asset.id, publisherId: actorId, robloxAssetId: parsed.assetId, robloxItemUrl: parsed.url, variantLabel: label, uploadNotes: "Recolour added after upload" })
    .returning();
  await db.insert(auditLog).values({ action: "addRobloxLink", entityType: "asset", entityId: asset.id, actorId, payload: { sku, url: parsed.url, variantLabel: label } });
  return { id: row.id, url: row.robloxItemUrl, robloxAssetId: row.robloxAssetId, variantLabel: row.variantLabel, onSaleAt: row.onSaleAt, createdAt: row.createdAt };
}

/**
 * Ticks one Roblox link on or off sale.
 *
 * Input: the SKU, the link's id, on or off, and who did it. Output: nothing. Throws OnSaleError
 * when the link isn't this asset's.
 */
export async function setLinkOnSale(sku: string, linkId: string, onSale: boolean, actorId: string | null): Promise<void> {
  const asset = await findAsset(sku);
  const now = new Date();
  const updated = await db
    .update(uploadRecords)
    .set(onSale ? { onSaleAt: now, onSaleBy: actorId } : { onSaleAt: null, onSaleBy: null })
    .where(and(eq(uploadRecords.id, linkId), eq(uploadRecords.assetId, asset.id)))
    .returning({ id: uploadRecords.id, url: uploadRecords.robloxItemUrl });
  if (updated.length === 0) throw new OnSaleError("That link isn't on this asset");
  await db.insert(auditLog).values({ action: onSale ? "putLinkOnSale" : "takeLinkOffSale", entityType: "asset", entityId: asset.id, actorId, payload: { sku, linkId, url: updated[0].url } });
}

export interface NotOnSaleAsset {
  sku: string;
  itemName: string;
  links: RobloxLinkView[];
}

/**
 * The Marketing page's "Variants not on sale" list: live assets with at least one Roblox link off
 * sale. An asset with some recolours already on sale stays listed until the last one is ticked.
 *
 * Output: those assets, by SKU, each with all its links and which of them are on sale.
 */
export async function listNotOnSale(): Promise<NotOnSaleAsset[]> {
  const rows = await db
    .select({
      sku: assets.sku,
      itemName: assets.itemName,
      id: uploadRecords.id,
      url: uploadRecords.robloxItemUrl,
      robloxAssetId: uploadRecords.robloxAssetId,
      variantLabel: uploadRecords.variantLabel,
      onSaleAt: uploadRecords.onSaleAt,
      createdAt: uploadRecords.createdAt,
    })
    .from(uploadRecords)
    .innerJoin(assets, eq(assets.id, uploadRecords.assetId))
    .where(and(inArray(assets.currentStatus, LIVE_ON_ROBLOX_STATUSES), isNull(assets.boardHiddenAt)))
    .orderBy(asc(assets.sku), asc(uploadRecords.createdAt), asc(uploadRecords.id));

  const bySku = new Map<string, NotOnSaleAsset>();
  for (const { sku, itemName, ...link } of rows) {
    const entry = bySku.get(sku) ?? { sku, itemName, links: [] };
    entry.links.push(link);
    bySku.set(sku, entry);
  }
  return [...bySku.values()].filter((asset) => asset.links.some((link) => !link.onSaleAt));
}
