import { desc, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";

/**
 * The condition every view of open work adds: the board, My Tasks, the calendar, the uploader queue,
 * Submit final files and the Dashboard's open-work counts. A card the team hid stays out of all of
 * them. Payments and history keep every asset.
 */
export function shownOnBoard(): SQL {
  return isNull(assets.boardHiddenAt);
}

/** The SKU matched no asset. */
export class AssetNotFoundError extends Error {}

/** A card the team took off the board, as the board's Hidden cards list shows it. */
export interface HiddenAsset {
  sku: string;
  itemName: string;
  currentStatus: string;
  artistName: string | null;
  hiddenAt: Date;
  hiddenByName: string | null;
  /** Why it was archived, or null for a card hidden before reasons were recorded. */
  hiddenReason: string | null;
}

/** Every hidden card, most recently hidden first. */
export async function listHiddenAssets(): Promise<HiddenAsset[]> {
  const artist = alias(personnel, "artist");
  const hider = alias(personnel, "hider");
  const rows = await db
    .select({
      sku: assets.sku,
      itemName: assets.itemName,
      currentStatus: assets.currentStatus,
      artistName: artist.name,
      hiddenAt: assets.boardHiddenAt,
      hiddenByName: hider.name,
      hiddenReason: assets.boardHiddenReason,
    })
    .from(assets)
    .leftJoin(artist, eq(artist.id, assets.currentArtistId))
    .leftJoin(hider, eq(hider.id, assets.boardHiddenBy))
    .where(isNotNull(assets.boardHiddenAt))
    .orderBy(desc(assets.boardHiddenAt), assets.sku);
  // isNotNull above guarantees hiddenAt; the select's type can't express that.
  return rows.map((row) => ({ ...row, hiddenAt: row.hiddenAt as Date }));
}

// Sets or clears the hidden columns and records the change in audit_log, in one transaction.
async function writeBoardVisibility(sku: string, hidden: boolean, actorId: string | null, reason: string | null = null): Promise<void> {
  await db.transaction(async (tx) => {
    const [asset] = await tx
      .update(assets)
      .set(
        hidden
          ? { boardHiddenAt: new Date(), boardHiddenBy: actorId, boardHiddenReason: reason }
          : { boardHiddenAt: null, boardHiddenBy: null, boardHiddenReason: null }
      )
      .where(eq(assets.sku, sku))
      .returning({ id: assets.id });
    if (!asset) throw new AssetNotFoundError(`No asset with SKU ${sku}`);
    await tx.insert(auditLog).values({
      action: hidden ? "hideAssetFromBoard" : "putAssetBackOnBoard",
      entityType: "asset",
      entityId: asset.id,
      actorId,
      payload: hidden && reason ? { sku, reason } : { sku },
    });
  });
}

/**
 * Archives several cards at once: each is taken off the board with its own reason, and logged.
 *
 * Input: the SKUs with their reasons, and who archived them. Output: the SKUs archived. Throws
 * AssetNotFoundError for an unknown SKU (the ones before it stay archived).
 */
export async function archiveAssets(items: { sku: string; reason: string }[], actorId: string | null): Promise<string[]> {
  const archived: string[] = [];
  for (const item of items) {
    await writeBoardVisibility(item.sku, true, actorId, item.reason);
    archived.push(item.sku);
  }
  return archived;
}

/**
 * Takes an asset's card off the board without deleting anything, and logs who did it.
 *
 * Input: the SKU and the acting person's id. Output: nothing. Throws AssetNotFoundError for an
 * unknown SKU.
 */
export async function hideAssetFromBoard(sku: string, actorId: string | null): Promise<void> {
  await writeBoardVisibility(sku, true, actorId);
}

/**
 * Puts a hidden card back on the board in the status it had, and logs who did it.
 *
 * Input: the SKU and the acting person's id. Output: nothing. Throws AssetNotFoundError for an
 * unknown SKU.
 */
export async function putAssetBackOnBoard(sku: string, actorId: string | null): Promise<void> {
  await writeBoardVisibility(sku, false, actorId);
}
