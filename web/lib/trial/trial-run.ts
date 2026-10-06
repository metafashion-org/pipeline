// The trial run: a test asset Jayesh takes through the whole pipeline on his own, with a bot playing
// the artist. The bot is a personnel row, "Trial Artist (bot)", whose emails go to Jayesh's inbox
// (a +trial address) and whose Discord messages go to Jayesh's DMs, so he sees exactly what a real
// artist sees. When the team does their part, the bot does the artist's part a few seconds later:
// accepts the offer, sends the work for review, makes changes when asked, and hands in a test .zip.

import { and, asc, desc, eq, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { assetOffers } from "@/lib/db/schema/asset_offers";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import { acceptOffer } from "@/lib/offers/offer-service";
import { nextFinalFilesVersion, submitFinalFiles } from "@/lib/deliverables/deliverables-service";
import { FINAL_ZIP_KIND } from "@/lib/deliverables/final-zip";
import { uploadFinalFilesZip, isConfigured as isDriveConfigured } from "@/lib/assets/drive-upload";
import { hideAssetFromBoard } from "@/lib/assets/board-visibility";
import { discordFetch, isConfigured as isDiscordConfigured } from "@/lib/discord/discord-service";
import { notifyReviewersOfReview, notifyUploadersOfReadyAsset } from "@/lib/notifications/pipeline-notices";

/** Whose inbox and Discord DMs get the bot's artist notices: the person running the trial. */
const TRIAL_RUNNER_EMAIL = "jsingh@metafashion.in";
// A +trial address lands in the runner's own Google Workspace inbox, and is unique in personnel.
const TRIAL_ARTIST_EMAIL = "jsingh+trial@metafashion.in";
const TRIAL_ARTIST_NAME = "Trial Artist (bot)";
export const TRIAL_SKU_PREFIX = "TRIAL-";
const TRIAL_ITEM_NAME = "TRIAL - End-to-end test hat";
// The bot waits this long before each move, so the notices arrive in the order a real artist's would.
// Short, because it runs after the team's request inside that request's time limit (maxDuration in the assign and status routes).
const BOT_PAUSE_MS = 1_500;
// The smallest valid .zip: an empty archive (just the end-of-central-directory record).
const EMPTY_ZIP = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTrialArtist() {
  const [row] = await db.select().from(personnel).where(eq(personnel.email, TRIAL_ARTIST_EMAIL)).limit(1);
  return row ?? null;
}

// The runner's Discord DM channel, so the bot's "artist channel" messages land in their DMs and never
// in a real artist's channel.
async function runnerDmChannel(): Promise<{ userId: string | null; channelId: string | null }> {
  const [runner] = await db.select({ discordUserId: personnel.discordUserId }).from(personnel).where(eq(personnel.email, TRIAL_RUNNER_EMAIL)).limit(1);
  const userId = runner?.discordUserId ?? null;
  if (!userId || !isDiscordConfigured()) return { userId, channelId: null };
  try {
    const dm = await discordFetch<{ id: string }>("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: userId }) });
    return { userId, channelId: dm.id };
  } catch (error) {
    console.error("[trial] couldn't open the runner's Discord DM:", error);
    return { userId, channelId: null };
  }
}

/** The trial asset in progress, or null. */
export async function currentTrialAsset() {
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(like(assets.sku, `${TRIAL_SKU_PREFIX}%`)))
    .orderBy(desc(assets.createdAt))
    .limit(1);
  return asset && !asset.boardHiddenAt ? asset : null;
}

/** Whether this asset's artist is the trial bot. */
async function isTrialAsset(sku: string) {
  const [row] = await db
    .select({ asset: assets, artistEmail: personnel.email })
    .from(assets)
    .leftJoin(personnel, eq(personnel.id, assets.currentArtistId))
    .where(eq(assets.sku, sku))
    .limit(1);
  return row && row.artistEmail === TRIAL_ARTIST_EMAIL ? row.asset : null;
}

/**
 * Starts a trial run: makes (or reactivates) the trial artist and a test asset in Unassigned, ready
 * to assign. Only one trial runs at a time.
 *
 * Input: who started it. Output: the test asset's SKU.
 */
export async function startTrialRun(actorId: string | null): Promise<string> {
  const existing = await currentTrialAsset();
  if (existing) return existing.sku;

  const dm = await runnerDmChannel();
  const artist = await findTrialArtist();
  if (artist) {
    await db
      .update(personnel)
      .set({ status: "Active", discordUserId: dm.userId, discordChannelId: dm.channelId, updatedAt: new Date() })
      .where(eq(personnel.id, artist.id));
  } else {
    await db.insert(personnel).values({
      name: TRIAL_ARTIST_NAME,
      email: TRIAL_ARTIST_EMAIL,
      roles: ["artist"],
      discordUserId: dm.userId,
      discordChannelId: dm.channelId,
      notes: "A bot that plays the artist in a trial run (lib/trial/trial-run.ts). Its emails and Discord messages go to Jayesh.",
    });
  }

  const sku = `${TRIAL_SKU_PREFIX}${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  const [asset] = await db
    .insert(assets)
    .values({ sku, itemName: TRIAL_ITEM_NAME, category: "Hat", currentStatus: "unassigned", feeAmount: "1.00", currency: "INR" })
    .returning();
  await db.insert(auditLog).values({ action: "startTrialRun", entityType: "asset", entityId: asset.id, actorId, payload: { sku } });
  return sku;
}

/**
 * Ends the trial: hides the test asset from the board (not deleted) and switches the trial artist off,
 * so it isn't offered real work or listed with the real artists.
 *
 * Input: who ended it. Output: nothing.
 */
export async function endTrialRun(actorId: string | null): Promise<void> {
  const asset = await currentTrialAsset();
  if (asset) await hideAssetFromBoard(asset.sku, actorId);
  const artist = await findTrialArtist();
  if (artist) await db.update(personnel).set({ status: "Inactive", updatedAt: new Date() }).where(eq(personnel.id, artist.id));
  await db.insert(auditLog).values({ action: "endTrialRun", entityType: "asset", entityId: asset?.id ?? null, actorId, payload: { sku: asset?.sku ?? null } });
}

function botActor(artistId: string) {
  return { roles: ["artist"], personnelId: artistId };
}

// Sends the work for review the way an artist does: In Production, then In Review, then the reviewers hear.
async function sendForReview(sku: string, artistId: string, note: string): Promise<void> {
  await updateAssetStatusInKanban(sku, "in_progress", botActor(artistId), note);
  await sleep(BOT_PAUSE_MS);
  await updateAssetStatusInKanban(sku, "in_review", botActor(artistId), "Trial bot: done, sending it for review");
  await notifyReviewersOfReview(sku);
}

/**
 * The bot's answer to an offer on a trial asset: it accepts, starts work, and sends it for review.
 * Called after the team assigns the asset. Does nothing for a real artist. Never throws.
 *
 * Input: the asset's SKU. Output: nothing.
 */
export async function trialBotAnswerOffer(sku: string): Promise<void> {
  try {
    const asset = await isTrialAsset(sku);
    if (!asset || !asset.currentArtistId) return;
    await sleep(BOT_PAUSE_MS);
    const [offer] = await db
      .select()
      .from(assetOffers)
      .where(and(eq(assetOffers.assetId, asset.id), eq(assetOffers.status, "pending")))
      .orderBy(desc(assetOffers.createdAt))
      .limit(1);
    if (!offer) return;
    await acceptOffer(offer.id, asset.currentArtistId);
    await sleep(BOT_PAUSE_MS);
    await sendForReview(sku, asset.currentArtistId, "Trial bot: accepted the offer and started work");
  } catch (error) {
    console.error(`[trial] bot couldn't answer the offer on ${sku}:`, error);
  }
}

/**
 * The bot's answer to the team moving a trial asset: after Revisions Requested it makes the changes
 * and sends it back for review; after Approved it hands in a test .zip. Does nothing for a real
 * artist's asset. Never throws.
 *
 * Input: the SKU and the status the team moved it to. Output: nothing.
 */
export async function trialBotAnswerMove(sku: string, status: string): Promise<void> {
  try {
    const asset = await isTrialAsset(sku);
    if (!asset || !asset.currentArtistId) return;
    if (status === "revisions_requested") {
      await sleep(BOT_PAUSE_MS);
      await sendForReview(sku, asset.currentArtistId, "Trial bot: making the requested changes");
    } else if (status === "approved") {
      await sleep(BOT_PAUSE_MS);
      await handInTestZip(sku, asset.id, asset.currentArtistId);
    }
  } catch (error) {
    console.error(`[trial] bot couldn't answer the move on ${sku}:`, error);
  }
}

// Hands in a tiny test .zip the way Submit final files does: into Drive, then recorded, which moves
// the asset to Ready for Upload; then the uploaders hear.
async function handInTestZip(sku: string, assetId: string, artistId: string): Promise<void> {
  if (!isDriveConfigured()) throw new Error("Drive isn't configured, so the bot can't hand in the .zip");
  const version = await nextFinalFilesVersion(assetId);
  const fileName = `${sku}-final-files.zip`;
  const uploaded = await uploadFinalFilesZip(sku, version, fileName, EMPTY_ZIP);
  await submitFinalFiles(
    sku,
    version,
    [{ kind: FINAL_ZIP_KIND, fileName, mimeType: "application/zip", sizeBytes: EMPTY_ZIP.length, driveFileId: uploaded.fileId, driveUrl: uploaded.url, driveFolderId: uploaded.folderId }],
    artistId,
    "Trial bot: test final files (an empty .zip)"
  );
  await notifyUploadersOfReadyAsset(sku);
}

/**
 * Where the trial asset is: its SKU, status, and which steps are done, read from its status history.
 *
 * Output: null when no trial is running.
 */
export async function trialProgress(): Promise<{ sku: string; status: string; reached: string[] } | null> {
  const asset = await currentTrialAsset();
  if (!asset) return null;
  const history = await db.select({ toStatus: statusHistory.toStatus }).from(statusHistory).where(eq(statusHistory.assetId, asset.id)).orderBy(asc(statusHistory.createdAt));
  return { sku: asset.sku, status: asset.currentStatus, reached: [...new Set(history.map((h) => h.toStatus))] };
}
