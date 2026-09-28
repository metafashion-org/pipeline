import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { eq } from "drizzle-orm";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { discordFetch, isConfigured as isDiscordConfigured } from "@/lib/discord/discord-service";
import { resolveArtistChannelId } from "@/lib/discord/artist-channel";
import { formatFee } from "@/lib/format-money";
import { formatDate } from "@/lib/format-date";
import { MAX_DEADLINE_EXTENSION_DAYS } from "./offer-rules";
import { renderEmailLayout, EMAIL_TONE, type EmailLayoutInput } from "@/lib/email/templates/email-layout";

/** Everything a notification about one offer shows, loaded once by offer-service.ts. */
export interface OfferSummary {
  offerId: string;
  assetId: string;
  sku: string;
  itemName: string;
  category: string | null;
  /** A publicly loadable thumbnail of the asset's first reference image, or null when it has none. */
  imageUrl: string | null;
  feeAmount: string | null;
  currency: string | null;
  offeredDeadline: Date;
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

// The site's own address, for links inside emails and Discord messages. NEXTAUTH_URL comes first
// because Google sign-in only works when it is the live domain, so it is always kept correct;
// NEXT_PUBLIC_APP_URL was once left pointing at a single old deployment. Read from process.env
// because this module is imported by tests, where lib/env.ts would throw.
function appUrl(path: string): string {
  const base = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return `${base}${path}`;
}

/** Where an artist answers their offers: their own My Tasks page. */
export function artistOffersUrl(): string {
  return appUrl("/artist#offers");
}

// The board opens straight to an asset's drawer when loaded with ?asset=<SKU> (see TaskCard.tsx).
function boardAssetUrl(sku: string): string {
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
function renderOfferEmail(
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
      { label: "Deadline", value: formatDate(deadline ?? summary.offeredDeadline) },
    ],
  });
}

// Queues each email, then tries to send straight away. A failed send stays queued and the daily
// cron retries it, so none of this is allowed to fail the action that caused the notification.
async function queueAndSend(assetId: string, toEmails: string[], subject: string, bodyHtml: string): Promise<void> {
  try {
    for (const toEmail of toEmails) {
      await enqueueEmail({ assetId, toEmail, subject, bodyHtml });
    }
    await sendDueEmails();
  } catch (error) {
    console.error("[offers] email notification failed:", error);
  }
}

interface ArtistDiscordMessage {
  content: string;
  title: string;
  description: string;
  color: number;
  summary: OfferSummary;
  withImage: boolean;
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
async function postToArtistChannel(message: ArtistDiscordMessage): Promise<void> {
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
            url: artistOffersUrl(),
            color: message.color,
            fields: [
              { name: "SKU", value: summary.sku, inline: true },
              { name: "Accessory type", value: summary.category || "Not set", inline: true },
              { name: "Fee", value: formatFee(summary.feeAmount, summary.currency, "Not set"), inline: true },
              { name: "Deadline", value: formatDate(summary.offeredDeadline), inline: true },
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
