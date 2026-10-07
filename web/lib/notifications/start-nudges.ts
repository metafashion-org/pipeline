// The check-in email between Assigned and In Production: one email per artist, listing every asset
// of theirs that has waited 12 hours or more for them to answer the offer or to start work. Sent at
// 09:00 and 21:00 India time by .github/workflows/artist-nudges.yml through /api/cron/artist-nudges.
// An asset drops off the list once its artist answers the offer or moves it to In Production.

import { and, eq, inArray, isNull, notLike } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { assetOffers, type OfferStatus } from "@/lib/db/schema/asset_offers";
import { personnel } from "@/lib/db/schema/personnel";
import { appSettings } from "@/lib/db/schema/app_settings";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { EMAIL_TONE, renderEmailLayout, type EmailDetailRow } from "@/lib/email/templates/email-layout";
import { appUrl } from "@/lib/app-url";
import { TRIAL_SKU_PREFIX } from "@/lib/trial/trial-run";

const ASSIGNED_STATUS = "assigned";
// 'pending': the artist hasn't answered. 'accepted': they said yes but haven't moved it to In
// Production. An 'extension_requested' offer waits on the team, so the artist isn't asked about it.
const NUDGE_OFFER_STATUSES: OfferStatus[] = ["pending", "accepted"];
const HOUR_MS = 60 * 60 * 1000;
// How long an asset waits (since the offer, or since it was accepted) before it's in a check-in.
const NUDGE_AFTER_HOURS = 12;
// The schedule runs every 12 hours, but GitHub often starts scheduled runs late, so a run counts as
// a repeat only within 10 hours of the last one. Without the margin a late run followed by an on-time
// one would skip a whole check-in.
const MIN_HOURS_BETWEEN_RUNS = 10;
const LAST_RUN_KEY = "artist_start_nudges_last_at";

export const START_NUDGE_SUBJECT = "A quick check-in on your assets";

interface WaitingAsset {
  sku: string;
  itemName: string;
  offerStatus: OfferStatus;
}

interface ArtistNudge {
  name: string;
  email: string;
  waiting: WaitingAsset[];
}

/** The check-in email for one artist. Exported for the test. */
export function renderStartNudgeEmail(nudge: ArtistNudge): string {
  const toAnswer = nudge.waiting.filter((a) => a.offerStatus === "pending");
  const toStart = nudge.waiting.filter((a) => a.offerStatus === "accepted");
  const firstName = nudge.name.trim().split(/\s+/)[0] || "there";

  const stats: EmailDetailRow[] = [];
  if (toAnswer.length > 0) stats.push({ label: "Offers to answer", value: String(toAnswer.length) });
  if (toStart.length > 0) stats.push({ label: "Ready to start", value: String(toStart.length) });

  const intro = [
    "Checking in on the assets below.",
    toAnswer.length > 0 ? "If you haven't answered an offer yet, you can accept or decline it on My Tasks." : "",
    toStart.length > 0 ? "If you've already started on one, drag it to In Production so the team can see it." : "",
  ]
    .filter(Boolean)
    .join(" ");

  const details: EmailDetailRow[] = [
    ...toAnswer.map((a) => ({ label: a.sku, value: `${a.itemName}: answer the offer` })),
    ...toStart.map((a) => ({ label: a.sku, value: `${a.itemName}: move to In Production once you've started` })),
  ];

  return renderEmailLayout({
    preheader: toStart.length > 0 ? "Started on something? Move it to In Production." : "An offer is waiting for your answer.",
    eyebrow: "Quick check-in",
    tone: EMAIL_TONE.neutral,
    title: `Hi ${firstName}`,
    meta: [],
    imageUrl: null,
    stats,
    intro,
    details,
    note: "Need more time, or can't take one on? That's fine. Tell the team and we'll sort it out.",
    button: { label: "Open My Tasks", url: appUrl("/artist") },
    footer: "You get this at most twice a day, and only while something is waiting on you.",
  });
}

// Every artist with an asset in Assigned that has waited long enough, with those assets.
async function artistsToNudge(now: Date): Promise<ArtistNudge[]> {
  const rows = await db
    .select({
      sku: assets.sku,
      itemName: assets.itemName,
      offerStatus: assetOffers.status,
      offeredAt: assetOffers.createdAt,
      respondedAt: assetOffers.respondedAt,
      artistId: personnel.id,
      artistName: personnel.name,
      artistEmail: personnel.email,
    })
    .from(assetOffers)
    .innerJoin(assets, eq(assets.id, assetOffers.assetId))
    .innerJoin(personnel, eq(personnel.id, assetOffers.artistId))
    .where(
      and(
        eq(assets.currentStatus, ASSIGNED_STATUS),
        inArray(assetOffers.status, NUDGE_OFFER_STATUSES),
        eq(personnel.status, "Active"),
        // Archived cards are off the board, and the trial run's bot follows its own script.
        isNull(assets.boardHiddenAt),
        notLike(assets.sku, `${TRIAL_SKU_PREFIX}%`)
      )
    )
    .orderBy(assets.sku);

  const cutoff = now.getTime() - NUDGE_AFTER_HOURS * HOUR_MS;
  const byArtist = new Map<string, ArtistNudge>();
  for (const row of rows) {
    // An accepted offer waits from the acceptance; an unanswered one from when it was sent.
    const waitingSince = row.offerStatus === "accepted" && row.respondedAt ? row.respondedAt : row.offeredAt;
    if (waitingSince.getTime() > cutoff) continue;
    const nudge = byArtist.get(row.artistId) ?? { name: row.artistName, email: row.artistEmail.toLowerCase(), waiting: [] };
    nudge.waiting.push({ sku: row.sku, itemName: row.itemName, offerStatus: row.offerStatus });
    byArtist.set(row.artistId, nudge);
  }
  return [...byArtist.values()];
}

/**
 * Emails each artist one check-in listing their assets waiting between Assigned and In Production.
 * Does nothing when the last run was under 10 hours ago, so extra calls never send twice.
 *
 * Input: the current time.
 * Output: how many artists were emailed.
 */
export async function sendArtistStartNudges(now: Date): Promise<number> {
  const [last] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LAST_RUN_KEY)).limit(1);
  if (typeof last?.value === "string" && now.getTime() - new Date(last.value).getTime() < MIN_HOURS_BETWEEN_RUNS * HOUR_MS) return 0;

  // Recorded before sending, so a second call moments later finds it and sends nothing.
  await db
    .insert(appSettings)
    .values({ key: LAST_RUN_KEY, value: now.toISOString(), updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: now.toISOString(), updatedAt: now } });

  const nudges = await artistsToNudge(now);
  for (const nudge of nudges) {
    await enqueueEmail({ toEmail: nudge.email, subject: START_NUDGE_SUBJECT, bodyHtml: renderStartNudgeEmail(nudge) });
  }
  if (nudges.length > 0) await sendDueEmails();
  return nudges.length;
}
