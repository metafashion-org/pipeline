import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { renderEmailLayout, EMAIL_TONE } from "@/lib/email/templates/email-layout";
import { appUrl } from "@/lib/app-url";
import { discordFetch, isConfigured as isDiscordConfigured } from "@/lib/discord/discord-service";
import { resolveArtistChannelId } from "@/lib/discord/artist-channel";

// Who hears when an artist saves or asks to change their details.
const DETAILS_NOTIFY_TO = "vkydlabs@gmail.com";
const DETAILS_NOTIFY_CC = ["arjun@metafashion.in"];

/** The artist's My details page. */
export function artistDetailsUrl(): string {
  return appUrl("/artist/profile");
}

/** The team's view of one artist's details. */
function teamDetailsUrl(personnelId: string): string {
  return appUrl(`/admin/artist-details?artist=${encodeURIComponent(personnelId)}`);
}

async function queueAndSend(toEmail: string, ccEmails: string[], subject: string, bodyHtml: string): Promise<void> {
  try {
    await enqueueEmail({ toEmail, ccEmails, subject, bodyHtml });
    await sendDueEmails();
  } catch (error) {
    console.error("[artist details] email failed:", error);
  }
}

export interface DetailsNoticeArtist {
  id: string;
  name: string;
  email: string;
}

/**
 * Emails the team that an artist saved their details for the first time, or asked to change them.
 * Never throws.
 *
 * Input: the artist, what happened, and for a change the fields and the artist's reason. Output: nothing.
 */
export async function notifyTeamOfArtistDetails(
  artist: DetailsNoticeArtist,
  event: { kind: "saved" } | { kind: "change_requested"; fields: string[]; reason: string }
): Promise<void> {
  const saved = event.kind === "saved";
  const subject = saved ? `${artist.name} added their payment details` : `${artist.name} asked to change their payment details`;
  await queueAndSend(
    DETAILS_NOTIFY_TO,
    DETAILS_NOTIFY_CC,
    subject,
    renderEmailLayout({
      preheader: subject,
      eyebrow: saved ? "Artist details saved" : "Change waiting for approval",
      tone: saved ? EMAIL_TONE.good : EMAIL_TONE.neutral,
      title: artist.name,
      meta: [artist.email],
      imageUrl: null,
      stats: [],
      intro: saved
        ? `${artist.name} filled in their UPI, bank and PAN details and uploaded their documents on the Kanban.`
        : `${artist.name} wants to change: ${event.fields.join(", ")}. The old details stay in use until you or Jayesh approve it.`,
      quote: saved ? undefined : { label: "Their reason", text: event.reason },
      button: { label: saved ? "See their details" : "Review the change", url: teamDetailsUrl(artist.id) },
      footer: "Sent by the Meta Fashion pipeline. Bank numbers are not included in emails.",
    })
  );
}

/** Tells an artist their change was approved or declined. Never throws. */
export async function notifyArtistOfDetailsDecision(artist: DetailsNoticeArtist, approved: boolean, note: string | null): Promise<void> {
  const subject = approved ? "Your details change was approved" : "Your details change was not approved";
  await queueAndSend(
    artist.email,
    [],
    subject,
    renderEmailLayout({
      preheader: subject,
      eyebrow: approved ? "Approved" : "Not approved",
      tone: approved ? EMAIL_TONE.good : EMAIL_TONE.bad,
      title: "My details",
      meta: [],
      imageUrl: null,
      stats: [],
      intro: approved
        ? `Hi ${artist.name}, your new details are saved. We'll use them for your next payment.`
        : `Hi ${artist.name}, we kept your earlier details. Reply to this email or message us on Discord if something needs fixing.`,
      quote: note ? { label: "Note", text: note } : undefined,
      button: { label: "Open My details", url: artistDetailsUrl() },
    })
  );
}

export interface DiscordArtist {
  id: string;
  name: string;
  discordUserId: string | null;
  discordChannelId: string | null;
}

/**
 * Posts a message to an artist on Discord: in their own channel, or by direct message when they have
 * none. Mentions them so they're notified.
 *
 * Input: the artist and the text. Output: whether it was sent. Never throws.
 */
export async function messageArtistOnDiscord(artist: DiscordArtist, text: string): Promise<boolean> {
  if (!isDiscordConfigured() || !artist.discordUserId) return false;
  try {
    let target = await resolveArtistChannelId({ id: artist.id, discordUserId: artist.discordUserId, discordChannelId: artist.discordChannelId });
    if (!target) {
      const dm = await discordFetch<{ id: string }>("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: artist.discordUserId }) });
      target = dm.id;
    }
    await discordFetch(`/channels/${target}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: `<@${artist.discordUserId}> ${text}`, allowed_mentions: { users: [artist.discordUserId] } }),
    });
    return true;
  } catch (error) {
    console.error(`[artist details] Discord message to ${artist.name} failed:`, error);
    return false;
  }
}

/** The Discord message asking an artist to fill in My details. */
export function detailsReminderText(name: string, prefilled: boolean): string {
  return [
    `Hi ${name}, quick one: we've moved artist details into the Kanban.`,
    `Please open **My details** at ${artistDetailsUrl()} and fill it in once: your UPI ID, bank account number, IFSC, PAN, and images of your Aadhaar, PAN and a cancelled cheque (or a bank app screenshot). Add your signed NDA too: a link to it is enough.`,
    prefilled ? "We've already copied your documents from the onboarding form, so just check them and add what's missing." : "",
    "This is what we use to pay you on the 15th and 30th. After you save, any change needs a short reason and our approval.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The message in a new artist's channel when they're onboarded, asking for their details. */
export function newArtistDetailsText(mention: string): string {
  return [
    `Welcome ${mention}. Before your first payment, please open **My details** at ${artistDetailsUrl()} and fill it in once:`,
    "your UPI ID, bank account number, IFSC, PAN, images of your Aadhaar, PAN and a cancelled cheque (or a bank app screenshot), and your signed NDA (a link is enough).",
    "We pay on the 15th and 30th using these details.",
  ].join(" ");
}

/** Emails an artist whose onboarding-form documents were copied in, asking them to check and finish. Never throws. */
export async function emailArtistToVerifyDetails(artist: DetailsNoticeArtist): Promise<void> {
  await queueAndSend(
    artist.email,
    [],
    "Please check your details on the Kanban",
    renderEmailLayout({
      preheader: "Check your details and add your bank account and UPI.",
      eyebrow: "My details",
      tone: EMAIL_TONE.neutral,
      title: "Check your details",
      meta: [],
      imageUrl: null,
      stats: [],
      intro: `Hi ${artist.name}, we've copied your onboarding details from the Google Form to the Kanban. Please open My details, check them, and add your bank account number, IFSC and UPI ID. Once that's done we'll pay you through the Kanban.`,
      button: { label: "Open My details", url: artistDetailsUrl() },
    })
  );
}
