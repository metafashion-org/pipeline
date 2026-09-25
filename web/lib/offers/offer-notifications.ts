import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { eq } from "drizzle-orm";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { discordFetch, isConfigured as isDiscordConfigured } from "@/lib/discord/discord-service";
import { formatFee } from "@/lib/format-money";
import { formatDate } from "@/lib/format-date";

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
  artistName: string;
  artistEmail: string;
  artistDiscordUserId: string | null;
  artistDiscordChannelId: string | null;
}

// Discord embed colours, as the decimal RGB values the API takes.
const EMBED_COLOR_OFFER = 0x2563eb;
const EMBED_COLOR_APPROVED = 0x16a34a;
const EMBED_COLOR_REJECTED = 0xdc2626;

// The site's own address, for links inside emails and Discord messages. Read from process.env
// because this module is imported by tests, where lib/env.ts would throw.
function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
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

// Item names, reasons and artist names are typed by people and end up inside HTML.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The emails of everyone who manages assignments: every Active person whose effective
 * capabilities (roles plus overrides) include canAssignArtists. They are told about deadline
 * requests and declines.
 */
async function getTeamEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: personnel.email, roles: personnel.roles, overrides: personnel.capabilityOverrides })
    .from(personnel)
    .where(eq(personnel.status, "Active"));
  return rows
    .filter((p) => getEffectiveCapabilities(p.roles, (p.overrides as Record<string, boolean>) || {}).canAssignArtists)
    .map((p) => p.email);
}

interface EmailRow {
  label: string;
  value: string;
}

// One layout for every offer email: a heading, a sentence, the asset's picture and facts, a button.
function renderEmail({
  heading,
  intro,
  summary,
  extraRows = [],
  button,
}: {
  heading: string;
  intro: string;
  summary: OfferSummary;
  extraRows?: EmailRow[];
  button: { label: string; url: string };
}): string {
  const rows: EmailRow[] = [
    { label: "Asset", value: summary.itemName },
    { label: "SKU", value: summary.sku },
    { label: "Accessory type", value: summary.category || "Not set" },
    { label: "Fee", value: formatFee(summary.feeAmount, summary.currency, "Not set") },
    { label: "Deadline", value: formatDate(summary.offeredDeadline) },
    ...extraRows,
  ];
  const rowsHtml = rows
    .map(
      (row, i) => `<tr style="${i % 2 === 0 ? "background:#f4f4f5;" : ""}">
        <td style="padding:8px;font-weight:bold;width:40%;">${escapeHtml(row.label)}</td>
        <td style="padding:8px;">${escapeHtml(row.value)}</td>
      </tr>`
    )
    .join("");
  const imageHtml = summary.imageUrl
    ? `<img src="${summary.imageUrl}" alt="${escapeHtml(summary.itemName)}" style="width:100%;max-width:552px;border-radius:6px;margin:12px 0;" />`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f5;color:#18181b;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;padding:24px;border-radius:8px;border:1px solid #e4e4e7;">
    <h2 style="margin-top:0;">${escapeHtml(heading)}</h2>
    <p>${escapeHtml(intro)}</p>
    ${imageHtml}
    <table style="width:100%;border-collapse:collapse;margin:12px 0;">${rowsHtml}</table>
    <p style="margin:20px 0;">
      <a href="${button.url}" style="background:#2563eb;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold;">${escapeHtml(button.label)}</a>
    </p>
    <p style="margin-top:24px;font-size:12px;color:#71717a;border-top:1px solid #e4e4e7;padding-top:12px;">
      Meta Fashion Pipeline
    </p>
  </div>
</body></html>`;
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

// Posts in the artist's own channel, mentioning them so Discord notifies them. Best-effort: an
// artist with no linked channel, or Discord being unset or down, only means no Discord message.
async function postToArtistChannel(message: ArtistDiscordMessage): Promise<void> {
  const { summary } = message;
  if (!summary.artistDiscordChannelId || !isDiscordConfigured()) return;
  const mention = summary.artistDiscordUserId ? `<@${summary.artistDiscordUserId}> ` : "";
  try {
    await discordFetch(`/channels/${summary.artistDiscordChannelId}/messages`, {
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
      `New asset offer | ${summary.sku} | ${summary.itemName}`,
      renderEmail({
        heading: "You have a new asset offer",
        intro: `Hi ${summary.artistName}, we'd like you to make this asset. Accept it, ask for a later deadline, or decline it on your My Tasks page.`,
        summary,
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
  const teamEmails = await getTeamEmails();
  await queueAndSend(
    summary.assetId,
    teamEmails,
    `Deadline request | ${summary.sku} | ${summary.artistName}`,
    renderEmail({
      heading: `${summary.artistName} asked for a later deadline`,
      intro: "Approve or reject it on the asset's card. The artist is told either way.",
      summary,
      extraRows: [
        { label: "Artist", value: summary.artistName },
        { label: "Requested deadline", value: formatDate(requestedDeadline) },
        { label: "Reason", value: reason || "None given" },
      ],
      button: { label: "Open the asset", url: boardAssetUrl(summary.sku) },
    })
  );
}

/** Tells the artist whether their requested deadline was approved. */
export async function notifyArtistOfExtensionDecision(
  summary: OfferSummary,
  approved: boolean,
  agreedDeadline: Date | null
): Promise<void> {
  const heading = approved ? "Your new deadline was approved" : "Your deadline request wasn't approved";
  const intro = approved
    ? `Hi ${summary.artistName}, your new deadline of ${formatDate(agreedDeadline)} is confirmed and the asset is yours.`
    : `Hi ${summary.artistName}, the original deadline of ${formatDate(summary.offeredDeadline)} stands. Accept the offer at that deadline, or decline it.`;
  await Promise.all([
    queueAndSend(
      summary.assetId,
      [summary.artistEmail],
      `${heading} | ${summary.sku}`,
      renderEmail({ heading, intro, summary, button: { label: "Open My Tasks", url: artistOffersUrl() } })
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
  const teamEmails = await getTeamEmails();
  await queueAndSend(
    summary.assetId,
    teamEmails,
    `Offer declined | ${summary.sku} | ${summary.artistName}`,
    renderEmail({
      heading: `${summary.artistName} declined ${summary.itemName}`,
      intro: "The asset is back in Unassigned, ready to offer to someone else.",
      summary,
      extraRows: [
        { label: "Artist", value: summary.artistName },
        { label: "Reason", value: reason || "None given" },
      ],
      button: { label: "Open the asset", url: boardAssetUrl(summary.sku) },
    })
  );
}
