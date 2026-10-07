// Reminders the team sends from the board when a card waits on someone: the artist to hand in final
// files (Approved), or the uploader to add the Roblox links (Ready for Upload). Discord and email,
// through the same senders as the pipeline's own notices.

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { appUrl } from "@/lib/app-url";
import { loadArtistSummary } from "./artist-status";
import { notifyUploadersOfReadyAsset } from "./pipeline-notices";
import { postToArtistChannel, queueAndSend } from "@/lib/offers/offer-notifications";
import { EMAIL_TONE, renderEmailLayout } from "@/lib/email/templates/email-layout";

const APPROVED_STATUS = "approved";
const READY_FOR_UPLOAD_STATUS = "ready_for_upload";
/** The statuses a card can be reminded from. */
export const REMINDABLE_STATUSES = [APPROVED_STATUS, READY_FOR_UPLOAD_STATUS];
// Discord embed colour (decimal RGB), the green used for approvals.
const EMBED_COLOR_FILES = 0x16a34a;
const ARTIST_MESSAGE = "Please upload the final files on the Kanban yourself, on Submit final files, so we can take it ahead in our pipeline. Files sent anywhere else don't move it on.";

export interface ReminderResult {
  sku: string;
  sent: "artist" | "uploader" | null;
}

async function remindArtist(sku: string): Promise<boolean> {
  const summary = await loadArtistSummary(sku);
  if (!summary) return false;
  const submitUrl = appUrl(`/artist/submit?sku=${encodeURIComponent(sku)}`);
  await postToArtistChannel({
    content: ARTIST_MESSAGE,
    title: `Upload final files: ${summary.itemName}`,
    description: "Upload the final .zip on Submit final files.",
    color: EMBED_COLOR_FILES,
    summary,
    withImage: true,
    url: submitUrl,
  });
  await queueAndSend(
    summary.assetId,
    [summary.artistEmail],
    `Please upload your final files: ${summary.itemName}`,
    renderEmailLayout({
      preheader: "Upload the final files on Submit final files.",
      eyebrow: "Final files",
      tone: EMAIL_TONE.good,
      title: summary.itemName,
      meta: [sku],
      imageUrl: null,
      stats: [],
      intro: ARTIST_MESSAGE,
      button: { label: "Submit final files", url: submitUrl },
    })
  );
  return true;
}

/**
 * Sends each card's reminder: the artist on an Approved card, the uploaders on a Ready for Upload
 * card. Cards in any other status are skipped.
 *
 * Input: the SKUs. Output: what was sent for each.
 */
export async function sendReminders(skus: string[]): Promise<ReminderResult[]> {
  if (skus.length === 0) return [];
  const rows = await db.select({ sku: assets.sku, status: assets.currentStatus }).from(assets).where(inArray(assets.sku, skus));
  const results: ReminderResult[] = [];
  for (const { sku, status } of rows) {
    if (status === APPROVED_STATUS) {
      results.push({ sku, sent: (await remindArtist(sku)) ? "artist" : null });
    } else if (status === READY_FOR_UPLOAD_STATUS) {
      await notifyUploadersOfReadyAsset(sku);
      results.push({ sku, sent: "uploader" });
    } else {
      results.push({ sku, sent: null });
    }
  }
  return results;
}

