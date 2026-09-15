import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { paymentBatches } from "@/lib/db/schema/payment_batches";
import { updateAssetPaymentDetails, SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/curation/curation-service";
import { updateAssetStatusInKanban, type TransitionActor } from "@/lib/kanban/kanban-service";
import { eq, and, asc } from "drizzle-orm";

export interface PendingPaymentAsset {
  id: string;
  sku: string;
  itemName: string;
  category: string | null;
  feeAmount: string | null;
  currency: string | null;
}

export interface ArtistPendingPayment {
  artistId: string;
  artistName: string;
  artistEmail: string;
  assets: PendingPaymentAsset[];
  // Keyed by currency, since an artist's pending assets are usually all one currency but nothing
  // stops two from differing — a batch attach can only cover one currency at a time (see
  // attachPaymentSummaryForArtist), so surfacing the split here is what lets the UI show it
  // rather than silently picking one.
  totalsByCurrency: Record<string, number>;
}

/**
 * Every artist with at least one asset sitting in marked_for_payment, grouped, with what they're
 * owed. This replaced a 15th/30th snapshot pull (payment_cycles) — payments aren't naturally
 * cycle-shaped, "who's owed what right now" is just a live read of the board.
 */
export async function getArtistsPendingPayment(): Promise<ArtistPendingPayment[]> {
  const rows = await db
    .select({
      assetId: assets.id,
      sku: assets.sku,
      itemName: assets.itemName,
      category: assets.category,
      feeAmount: assets.feeAmount,
      currency: assets.currency,
      artistId: personnel.id,
      artistName: personnel.name,
      artistEmail: personnel.email,
    })
    .from(assets)
    .innerJoin(personnel, eq(assets.currentArtistId, personnel.id))
    .where(eq(assets.currentStatus, "marked_for_payment"))
    .orderBy(asc(personnel.name), asc(assets.sku));

  const byArtist = new Map<string, ArtistPendingPayment>();
  for (const row of rows) {
    let entry = byArtist.get(row.artistId);
    if (!entry) {
      entry = { artistId: row.artistId, artistName: row.artistName, artistEmail: row.artistEmail, assets: [], totalsByCurrency: {} };
      byArtist.set(row.artistId, entry);
    }
    entry.assets.push({
      id: row.assetId,
      sku: row.sku,
      itemName: row.itemName,
      category: row.category,
      feeAmount: row.feeAmount,
      currency: row.currency,
    });
    const currency = row.currency || "INR";
    const amount = row.feeAmount ? Number(row.feeAmount) : 0;
    entry.totalsByCurrency[currency] = (entry.totalsByCurrency[currency] || 0) + amount;
  }

  return Array.from(byArtist.values());
}

export interface AttachPaymentSummaryOptions {
  artistId: string;
  receiptUrl: string;
  receiptFileName: string;
  actor: TransitionActor;
}

export interface AttachPaymentSummaryResult {
  batchId: string;
  artistId: string;
  totalAmount: number;
  currency: string;
  assetCount: number;
  skus: string[];
}

/**
 * Attaches one payment summary to every asset currently marked_for_payment for this artist, and
 * moves all of them to payment_done together. Re-reads the pending list at write time rather than
 * trusting whatever the client last rendered — someone could have re-marked an asset, or a second
 * payment_admin could be mid-batch on the same artist, between the page loading and this call.
 *
 * Deliberately one currency per batch: mixed-currency pending assets for the same artist are rare
 * (MetaFashion pays INR by default) and "what does a single payment summary PDF for two
 * currencies even mean" doesn't have a good answer, so this refuses rather than guessing — the
 * caller pays each currency's assets as a separate batch.
 */
export async function attachPaymentSummaryForArtist(options: AttachPaymentSummaryOptions): Promise<AttachPaymentSummaryResult> {
  const { artistId, receiptUrl, receiptFileName, actor } = options;

  const artistRecord = await db.select().from(personnel).where(eq(personnel.id, artistId)).limit(1);
  if (artistRecord.length === 0) throw new Error("Artist not found");

  const pending = await db
    .select({ id: assets.id, sku: assets.sku, feeAmount: assets.feeAmount, currency: assets.currency })
    .from(assets)
    .where(and(eq(assets.currentArtistId, artistId), eq(assets.currentStatus, "marked_for_payment")));

  if (pending.length === 0) {
    throw new Error(`${artistRecord[0].name} has no assets marked for payment right now`);
  }

  const currencies = new Set(pending.map((a) => a.currency || "INR"));
  if (currencies.size > 1) {
    throw new Error(
      `${artistRecord[0].name}'s pending assets are split across ${currencies.size} currencies (${Array.from(currencies).join(", ")}) — pay each currency as its own batch.`
    );
  }
  const currency = Array.from(currencies)[0] as SupportedCurrency;
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new Error(`Unsupported currency '${currency}' on one or more pending assets`);
  }

  const totalAmount = pending.reduce((sum, a) => sum + (a.feeAmount ? Number(a.feeAmount) : 0), 0);

  const [batch] = await db
    .insert(paymentBatches)
    .values({
      artistId,
      receiptUrl,
      receiptFileName,
      totalAmount: totalAmount.toFixed(2),
      currency,
      assetCount: pending.length,
      createdBy: actor.system ? null : actor.personnelId || null,
    })
    .returning();

  // Sequential, not Promise.all: each call re-checks the transition gate and writes its own
  // status_history/audit_log row, and a handful of assets per artist is the normal case — there's
  // no real throughput to gain by parallelizing writes to the same artist's records.
  for (const asset of pending) {
    await updateAssetPaymentDetails(
      asset.sku,
      { paymentReceiptUrl: receiptUrl, paymentBatchId: batch.id },
      actor.system ? undefined : actor.personnelId,
      `Payment summary attached for ${artistRecord[0].name} (batch ${batch.id})`
    );
    await updateAssetStatusInKanban(
      asset.sku,
      "payment_done",
      actor,
      `Paid as part of ${artistRecord[0].name}'s payout batch`
    );
  }

  return {
    batchId: batch.id,
    artistId,
    totalAmount,
    currency,
    assetCount: pending.length,
    skus: pending.map((a) => a.sku),
  };
}
