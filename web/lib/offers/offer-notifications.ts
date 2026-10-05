import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { eq } from "drizzle-orm";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { discordFetch, isConfigured as isDiscordConfigured } from "@/lib/discord/discord-service";
import { resolveArtistChannelId } from "@/lib/discord/artist-channel";
import { formatFee } from "@/lib/format-money";
import { formatDate } from "@/lib/format-date";
import { appUrl } from "@/lib/app-url";
import { MAX_DEADLINE_EXTENSION_DAYS } from "./offer-rules";
import { renderEmailLayout, EMAIL_TONE, type EmailLayoutInput } from "@/lib/email/templates/email-layout";

/**
 * Everything a notification to or about an asset's artist shows: loaded by offer-service.ts for an
 * offer, and by lib/notifications/artist-approval.ts when the asset is approved.
 */
export interface OfferSummary {
  /** The offer this is about, or null for a notification that isn't about an offer. */
  offerId: string | null;
  assetId: string;
  sku: string;
  itemName: string;
  category: string | null;
  /** A publicly loadable thumbnail of the asset's first reference image, or null when it has none. */
  imageUrl: string | null;
  feeAmount: string | null;
  currency: string | null;
  /** The deadline shown: the one offered, or the asset's own outside an offer. Null when it has none. */
  offeredDeadline: Date | null;
  artistId: string;
  /** The personnel id of whoever sent the offer, or null when the system sent it. */
  offeredById: string | null;
  artistName: string;
  artistEmail: string;
  artistDiscordUserId: string | null;
  artistDiscordChannelId: string | null;
}

// Discord embed colours, as the decimal RGB values the API takes.
const EMBED_COLOR_OFFER = 0x2563eb;
const EMBED_COLOR_APPROVED = 0x16a34a;
const EMBED_COLOR_REJECTED = 0xdc2626;
const EMBED_COLOR_REVISIONS = 0xf59e0b;

/** Where an artist answers their offers: their own My Tasks page. */
export function artistOffersUrl(): string {
  return appUrl("/artist#offers");
}

// The artist's My Tasks board with this asset's card open (TaskCard opens on ?asset=<SKU>).
function artistAssetUrl(sku: string): string {
  return appUrl(`/artist?asset=${encodeURIComponent(sku)}`);
}

// Submit final files, opened with the asset already picked (see app/(shell)/artist/submit/page.tsx).
function finalFilesSubmitUrl(sku: string): string {
  return appUrl(`/artist/submit?sku=${encodeURIComponent(sku)}`);
}

// The board opens straight to an asset's drawer when loaded with ?asset=<SKU> (see TaskCard.tsx).
export function boardAssetUrl(sku: string): string {
  return appUrl(`/admin/board?asset=${encodeURIComponent(sku)}`);
}

// Always told about deadline requests and declines, on top of whoever sent the offer.
const TEAM_NOTIFY_EMAILS = ["arjun@metafashion.in"];

/**
 * Who hears about an artist's deadline request or decline: the person who sent the offer, since
 * they manage that artist, plus TEAM_NOTIFY_EMAILS. Other admins are left out on purpose.
 */
async function getTeamEmails(summary: OfferSummary): Promise<string[]> {
  const emails = new Set(TEAM_NOTIFY_EMAILS);
  if (summary.offeredById) {
    const [sender] = await db
      .select({ email: personnel.email, status: personnel.status })
      .from(personnel)
      .where(eq(personnel.id, summary.offeredById))
      .limit(1);
    if (sender?.status === "Active") emails.add(sender.email.toLowerCase());
  }
  return [...emails];
}

// Every offer email shows the asset the same way: picture, name, SKU and type, fee and deadline.
export function renderOfferEmail(
  summary: OfferSummary,
  parts: Pick<EmailLayoutInput, "preheader" | "eyebrow" | "tone" | "intro" | "quote" | "details" | "note" | "button"> & {
    deadline?: Date | null;
  }
): string {
  const { deadline, ...rest } = parts;
  return renderEmailLayout({
    ...rest,
    title: summary.itemName,
    meta: [summary.sku, summary.category || ""],
    imageUrl: summary.imageUrl,
    stats: [
      { label: "Fee", value: formatFee(summary.feeAmount, summary.currency, "Not set") },
      { label: "Deadline", value: formatDate(deadline ?? summary.offeredDeadline, "Not set") },
    ],
  });
}

// Queues each email, then tries to send straight away. A failed send stays queued and the daily
// cron retries it, so none of this is allowed to fail the action that caused the notification.
export async function queueAndSend(assetId: string, toEmails: string[], subject: string, bodyHtml: string): Promise<void> {
  try {
    for (const toEmail of toEmails) {
      await enqueueEmail({ assetId, toEmail, subject, bodyHtml });
    }
    await sendDueEmails();
  } catch (error) {
    console.error("[offers] email notification failed:", error);
  }
}

export interface ArtistDiscordMessage {
  content: string;
  title: string;
  description: string;
  color: number;
  summary: OfferSummary;
  withImage: boolean;
  /** Where the embed's title links. My Tasks when not given. */
  url?: string;
}

// Where an artist's Discord messages go: their own channel, found and saved on the spot when the
// record has none yet, or else a direct message from the bot. Null when they have no Discord
// account linked at all.
async function artistDiscordTarget(summary: OfferSummary): Promise<string | null> {
  const channelId = await resolveArtistChannelId({
    id: summary.artistId,
    discordUserId: summary.artistDiscordUserId,
    discordChannelId: summary.artistDiscordChannelId,
  });
  if (channelId) return channelId;
  if (!summary.artistDiscordUserId) return null;
  const dm = await discordFetch<{ id: string }>("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: summary.artistDiscordUserId }),
  });
  return dm.id;
}

// Posts to the artist on Discord, mentioning them so Discord notifies them. Best-effort: no
// Discord account, Discord being unset or down, or DMs turned off only means no Discord message.
export async function postToArtistChannel(message: ArtistDiscordMessage): Promise<void> {
  const { summary } = message;
  if (!isDiscordConfigured()) return;
  const mention = summary.artistDiscordUserId ? `<@${summary.artistDiscordUserId}> ` : "";
  try {
    const target = await artistDiscordTarget(summary);
    if (!target) {
      console.warn(`[offers] ${summary.artistName} has no Discord account linked; sent email only.`);
      return;
    }
    await discordFetch(`/channels/${target}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: `${mention}${message.content}`,
        embeds: [
          {
            title: message.title,
            description: message.description,
            url: message.url ?? artistOffersUrl(),
            color: message.color,
            fields: [
              { name: "SKU", value: summary.sku, inline: true },
              { name: "Accessory type", value: summary.category || "Not set", inline: true },
              { name: "Fee", value: formatFee(summary.feeAmount, summary.currency, "Not set"), inline: true },
              { name: "Deadline", value: formatDate(summary.offeredDeadline, "Not set"), inline: true },
            ],
            ...(message.withImage && summary.imageUrl ? { image: { url: summary.imageUrl } } : {}),
          },
        ],
      }),
    });
  } catch (error) {
    console.error("[offers] Discord notification failed:", error);
  }
}

/** Tells the artist about a new offer, by email and in their Discord channel. */
export async function notifyArtistOfOffer(summary: OfferSummary): Promise<void> {
  await Promise.all([
    queueAndSend(
      summary.assetId,
      [summary.artistEmail],
      `New offer: ${summary.itemName} (${summary.sku})`,
      renderOfferEmail(summary, {
        preheader: `${formatFee(summary.feeAmount, summary.currency, "Fee not set")}, due ${formatDate(summary.offeredDeadline)}. Accept, ask for more time, or decline.`,
        eyebrow: "New offer",
        tone: EMAIL_TONE.neutral,
        intro: `Hi ${summary.artistName}, we'd like you to make this one. Accept it, ask for up to ${MAX_DEADLINE_EXTENSION_DAYS} more days, or decline it. The full brief arrives once you accept.`,
        button: { label: "Answer the offer", url: artistOffersUrl() },
      })
    ),
    postToArtistChannel({
      content: "you have a new asset offer.",
      title: `${summary.itemName} (${summary.sku})`,
      description: "Accept it, ask for a later deadline, or decline it on your My Tasks page.",
      color: EMBED_COLOR_OFFER,
      summary,
      withImage: true,
    }),
  ]);
}

/**
 * Tells the artist the team approved their asset, by email and in their Discord channel, with a
 * button that opens Submit final files with the asset picked.
 */
export async function notifyArtistOfApproval(summary: OfferSummary): Promise<void> {
  const submitUrl = finalFilesSubmitUrl(summary.sku);
  await Promise.all([
    queueAndSend(
      summary.assetId,
      [summary.artistEmail],
      `Approved: ${summary.itemName} (${summary.sku}). Hand in your final files`,
      renderOfferEmail(summary, {
        preheader: "Hand in the final files as one .zip.",
        eyebrow: "Approved",
        tone: EMAIL_TONE.good,
        intro: `Hi ${summary.artistName}, the team approved ${summary.itemName}. Hand in the final files as one .zip with the images, the FBX and the texture maps. The page lists what goes in it for this asset.`,
        button: { label: "Hand in final files", url: submitUrl },
      })
    ),
    postToArtistChannel({
      content: "your asset was approved. Hand in the final files.",
      title: `${summary.itemName} (${summary.sku})`,
      description: "Upload one .zip with everything in it on Submit final files. The page lists what goes in it.",
      color: EMBED_COLOR_APPROVED,
      summary,
      withImage: true,
      url: submitUrl,
    }),
  ]);
}

// What an artist does once the team asks for changes. Those are the moves the pipeline gives them
// out of Revisions Requested (see the rules in lib/db/seed-statuses.ts).
const AFTER_REVISIONS_STEPS =
  "Move the card to In Production while you make the changes, then to In Review when they're done. The team checks it and approves it.";

/**
 * Tells the artist the team asked for changes, by email and in their Discord channel, and what to do
 * once they've made them. The email's button opens the asset's card on My Tasks.
 */
export async function notifyArtistOfRevisions(summary: OfferSummary): Promise<void> {
  const cardUrl = artistAssetUrl(summary.sku);
  await Promise.all([
    queueAndSend(
      summary.assetId,
      [summary.artistEmail],
      `Changes requested: ${summary.itemName} (${summary.sku})`,
      renderOfferEmail(summary, {
        preheader: "The team asked for changes. Move it to In Review when they're done.",
        eyebrow: "Revisions requested",
        tone: EMAIL_TONE.neutral,
        intro: `Hi ${summary.artistName}, the team asked for changes on ${summary.itemName}. ${AFTER_REVISIONS_STEPS}`,
        button: { label: "Open My Tasks", url: cardUrl },
      })
    ),
    postToArtistChannel({
      content: "the team asked for changes on your asset.",
      title: `${summary.itemName} (${summary.sku})`,
      description: AFTER_REVISIONS_STEPS,
      color: EMBED_COLOR_REVISIONS,
      summary,
      withImage: false,
      url: cardUrl,
    }),
  ]);
}

/** Tells the team an artist asked for a later deadline, and why. */
export async function notifyTeamOfExtensionRequest(
  summary: OfferSummary,
  requestedDeadline: Date,
  reason: string | null
): Promise<void> {
  const teamEmails = await getTeamEmails(summary);
  await queueAndSend(
    summary.assetId,
    teamEmails,
    `Deadline request: ${summary.itemName} (${summary.sku}) from ${summary.artistName}`,
    renderOfferEmail(summary, {
      preheader: `${summary.artistName} wants ${formatDate(requestedDeadline)} instead of ${formatDate(summary.offeredDeadline)}.`,
      eyebrow: "Deadline request",
      tone: EMAIL_TONE.neutral,
      intro: `${summary.artistName} asked to move the deadline from ${formatDate(summary.offeredDeadline)} to ${formatDate(requestedDeadline)}. Approve or reject it on the asset's card. They are told either way.`,
      quote: reason ? { label: `${summary.artistName}'s reason`, text: reason } : undefined,
      button: { label: "Review the request", url: boardAssetUrl(summary.sku) },
    })
  );
}

/** Tells the artist whether their requested deadline was approved. */
export async function notifyArtistOfExtensionDecision(
  summary: OfferSummary,
  approved: boolean,
  agreedDeadline: Date | null
): Promise<void> {
  const intro = approved
    ? `Hi ${summary.artistName}, your new deadline of ${formatDate(agreedDeadline)} is confirmed and the asset is yours. The full brief follows in a separate email.`
    : `Hi ${summary.artistName}, the original deadline of ${formatDate(summary.offeredDeadline)} stands. Accept the offer at that deadline, or decline it.`;
  await Promise.all([
    queueAndSend(
      summary.assetId,
      [summary.artistEmail],
      `${approved ? "New deadline approved" : "Deadline request not approved"}: ${summary.itemName} (${summary.sku})`,
      renderOfferEmail(summary, {
        preheader: approved ? `Your deadline is now ${formatDate(agreedDeadline)}.` : `The deadline stays ${formatDate(summary.offeredDeadline)}.`,
        eyebrow: approved ? "Deadline approved" : "Deadline not approved",
        tone: approved ? EMAIL_TONE.good : EMAIL_TONE.bad,
        intro,
        deadline: approved ? agreedDeadline : summary.offeredDeadline,
        button: { label: approved ? "Open My Tasks" : "Answer the offer", url: artistOffersUrl() },
      })
    ),
    postToArtistChannel({
      content: approved ? "your deadline request was approved." : "your deadline request wasn't approved.",
      title: `${summary.itemName} (${summary.sku})`,
      description: intro,
      color: approved ? EMBED_COLOR_APPROVED : EMBED_COLOR_REJECTED,
      summary,
      withImage: false,
    }),
  ]);
}

/** Tells the team an artist declined an offer, with their reason if they gave one. */
export async function notifyTeamOfDecline(summary: OfferSummary, reason: string | null): Promise<void> {
  const teamEmails = await getTeamEmails(summary);
  await queueAndSend(
    summary.assetId,
    teamEmails,
    `Offer declined: ${summary.itemName} (${summary.sku}) by ${summary.artistName}`,
    renderOfferEmail(summary, {
      preheader: reason ? `Reason: ${reason}` : `${summary.artistName} gave no reason.`,
      eyebrow: "Offer declined",
      tone: EMAIL_TONE.bad,
      intro: `${summary.artistName} declined this asset. It is back in Unassigned, ready to offer to someone else.`,
      quote: { label: `${summary.artistName}'s reason`, text: reason || "No reason given." },
      button: { label: "Reassign the asset", url: boardAssetUrl(summary.sku) },
    })
  );
}
