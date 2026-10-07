// Notices for the asset steps after the artist starts work, so each person hears when it's their
// turn: the reviewers when an artist sends work for review, the uploaders when final files are in,
// and the artist when it's paid. Artists aren't told when or where an asset goes on Roblox: the
// Roblox side of the business is ours (see seesBusinessDetails in lib/auth/rbac.ts). Every function here is
// best-effort and never throws: a notice that fails must not undo the move that caused it.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { assets } from "@/lib/db/schema/assets";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { appUrl } from "@/lib/app-url";
import { formatFee } from "@/lib/format-money";
import { EMAIL_TONE, renderEmailLayout } from "@/lib/email/templates/email-layout";
import { postToOfficeChannel } from "@/lib/discord/office-channel";
import { listTeamMembers } from "@/lib/team-tasks/team-members";
import { boardAssetUrl, postToArtistChannel, queueAndSend, renderOfferEmail, type OfferSummary } from "@/lib/offers/offer-notifications";
import { loadArtistSummary } from "./artist-status";
import { getFinalFilesForAsset } from "@/lib/deliverables/deliverables-service";

// Discord embed colours, as the decimal RGB values the API takes.
const EMBED_COLOR_REVIEW = 0x7c3aed;
const EMBED_COLOR_UPLOAD = 0x0891b2;
const EMBED_COLOR_PAID = 0x15803d;
// Roles that upload to Roblox; the Uploader Queue (/publisher) is theirs.
const UPLOADER_ROLES = ["publisher", "uploader"];

interface Recipient {
  name: string;
  email: string;
  discordUserId: string | null;
}

// Active people whose roles and overrides pass a test, e.g. "can approve".
async function activePeopleWhere(test: (roles: string[], overrides: Record<string, boolean>) => boolean): Promise<Recipient[]> {
  const rows = await db
    .select({ name: personnel.name, email: personnel.email, roles: personnel.roles, overrides: personnel.capabilityOverrides, discordUserId: personnel.discordUserId })
    .from(personnel)
    .where(eq(personnel.status, "Active"));
  return rows
    .filter((r) => test(r.roles ?? [], (r.overrides as Record<string, boolean>) ?? {}))
    .map((r) => ({ name: r.name, email: r.email.toLowerCase(), discordUserId: r.discordUserId }));
}

// Who reviews artists' work: the full-time team members who can approve it. Admin and test logins
// without the full_time role are left out.
function reviewers(): Promise<Recipient[]> {
  return activePeopleWhere((roles, overrides) => {
    const lower = roles.map((r) => r.toLowerCase());
    return lower.includes("full_time") && getEffectiveCapabilities(roles, overrides).canApprove;
  });
}

function uploaders(): Promise<Recipient[]> {
  return activePeopleWhere((roles) => roles.some((r) => UPLOADER_ROLES.includes(r.toLowerCase())));
}

// Posts in #office, pinging the given people. The full-time team is passed so the channel stays
// open to all of them (see lib/discord/office-channel.ts).
async function postToOffice(content: string, embed: Record<string, unknown>, ping: Recipient[]): Promise<void> {
  const members = await listTeamMembers();
  const mentionDiscordIds = ping.map((p) => p.discordUserId).filter((id): id is string => Boolean(id));
  await postToOfficeChannel({
    content: `${mentionDiscordIds.map((id) => `<@${id}>`).join(" ")} ${content}`.trim(),
    embeds: [embed],
    mentionDiscordIds,
    memberDiscordIds: members.map((m) => m.discordUserId).filter((id): id is string => Boolean(id)),
  });
}

function assetEmbedFields(summary: OfferSummary) {
  return [
    { name: "SKU", value: summary.sku, inline: true },
    { name: "Artist", value: summary.artistName, inline: true },
    { name: "Accessory type", value: summary.category || "Not set", inline: true },
  ];
}

/**
 * Tells the reviewers an artist sent an asset for review: an email each and a post in #office
 * pinging them, both linking to the asset on the board.
 *
 * Input: the asset's SKU. Output: nothing.
 */
export async function notifyReviewersOfReview(sku: string): Promise<void> {
  try {
    const summary = await loadArtistSummary(sku);
    if (!summary) return;
    const people = await reviewers();
    const url = boardAssetUrl(sku);
    await Promise.all([
      queueAndSend(
        summary.assetId,
        people.map((p) => p.email),
        `Ready for review: ${summary.itemName} (${summary.sku}) from ${summary.artistName}`,
        renderOfferEmail(summary, {
          preheader: `${summary.artistName} sent it for review. Approve it or ask for changes.`,
          eyebrow: "Ready for review",
          tone: EMAIL_TONE.neutral,
          intro: `${summary.artistName} sent ${summary.itemName} for review. Open it on the board, then move it to Approved or Revisions Requested. The artist is told either way.`,
          button: { label: "Review it on the board", url },
        })
      ),
      postToOffice(
        `${summary.artistName} sent **${summary.itemName}** for review.`,
        { title: `${summary.itemName} (${summary.sku})`, url, color: EMBED_COLOR_REVIEW, description: "Approve it or ask for changes on the board.", fields: assetEmbedFields(summary) },
        people
      ),
    ]);
  } catch (error) {
    console.error(`[pipeline notice] review notice for ${sku} failed:`, error);
  }
}

/**
 * Tells the uploaders an asset's final files are in and it's waiting in the Uploader Queue: an
 * email each and a post in #office pinging them, with the Drive folder of the files.
 *
 * Input: the asset's SKU. Output: nothing.
 */
export async function notifyUploadersOfReadyAsset(sku: string): Promise<void> {
  try {
    const summary = await loadArtistSummary(sku);
    if (!summary) return;
    const people = await uploaders();
    const [latest] = await getFinalFilesForAsset(summary.assetId);
    const queueUrl = appUrl("/publisher");
    const folderLine = latest ? `The final files (version ${latest.version}) are in Drive: ${latest.folderUrl}` : "The final files are in the asset's Drive folder.";
    await Promise.all([
      queueAndSend(
        summary.assetId,
        people.map((p) => p.email),
        `Ready to upload: ${summary.itemName} (${summary.sku})`,
        renderEmailLayout({
          preheader: "Final files are in. Upload it to Roblox, then add the links on the Uploader Queue.",
          eyebrow: "Ready for upload",
          tone: EMAIL_TONE.neutral,
          title: summary.itemName,
          meta: [summary.sku, summary.category || ""],
          imageUrl: summary.imageUrl,
          stats: [],
          intro: `${summary.artistName} handed in the final files for ${summary.itemName}. ${folderLine}. Upload it to Roblox, then add the item links on the Uploader Queue so the asset moves to Uploaded to Roblox.`,
          button: { label: "Open the Uploader Queue", url: queueUrl },
        })
      ),
      postToOffice(
        `**${summary.itemName}** is ready to upload to Roblox.`,
        {
          title: `${summary.itemName} (${summary.sku})`,
          url: queueUrl,
          color: EMBED_COLOR_UPLOAD,
          description: latest ? `Final files v${latest.version}: ${latest.folderUrl}` : "Final files are in the asset's Drive folder.",
          fields: assetEmbedFields(summary),
        },
        people
      ),
    ]);
  } catch (error) {
    console.error(`[pipeline notice] upload notice for ${sku} failed:`, error);
  }
}

/**
 * Tells the artist they've been paid for one or more assets, by email and in their Discord
 * channel, with each SKU and the total.
 *
 * Input: the paid assets' SKUs (all the same artist's). Output: nothing.
 */
export async function notifyArtistOfPayment(skus: string[]): Promise<void> {
  try {
    if (skus.length === 0) return;
    const summary = await loadArtistSummary(skus[0]);
    if (!summary) return;
    const paid = await db
      .select({ sku: assets.sku, itemName: assets.itemName, feeAmount: assets.feeAmount, currency: assets.currency })
      .from(assets)
      .where(and(eq(assets.currentArtistId, summary.artistId)));
    const rows = paid.filter((a) => skus.includes(a.sku));
    const total = rows.reduce((sum, a) => sum + (a.feeAmount ? Number(a.feeAmount) : 0), 0);
    const currency = rows[0]?.currency ?? summary.currency;
    const lines = rows.map((a) => `${a.sku} · ${a.itemName} · ${formatFee(a.feeAmount, a.currency, "fee not set")}`);
    const totalText = formatFee(total.toFixed(2), currency, "not set");
    await Promise.all([
      queueAndSend(
        summary.assetId,
        [summary.artistEmail],
        `Paid: ${rows.length} asset${rows.length === 1 ? "" : "s"}, ${totalText}`,
        renderEmailLayout({
          preheader: `We've paid you ${totalText}.`,
          eyebrow: "Payment done",
          tone: EMAIL_TONE.good,
          title: `Paid ${totalText}`,
          meta: [summary.artistName],
          imageUrl: null,
          stats: [{ label: "Total", value: totalText }],
          intro: `Hi ${summary.artistName}, we've paid you for ${rows.length === 1 ? "this asset" : "these assets"}. It reaches your account on your bank's usual timing.`,
          details: lines.map((line) => ({ label: "Asset", value: line })),
          button: { label: "Open My Tasks", url: appUrl("/artist") },
        })
      ),
      postToArtistChannel({
        content: `you've been paid ${totalText}.`,
        title: `Payment done: ${rows.length} asset${rows.length === 1 ? "" : "s"}`,
        description: lines.join("\n"),
        color: EMBED_COLOR_PAID,
        summary,
        withImage: false,
        url: appUrl("/artist"),
      }),
    ]);
  } catch (error) {
    console.error(`[pipeline notice] payment notice for ${skus.join(", ")} failed:`, error);
  }
}
