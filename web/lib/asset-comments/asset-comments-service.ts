// Comments on an asset's card. Staff write them in the asset drawer and @mention the full-time team
// or freelancers (artists). A team member is told in the Team Tasks bell, by email and in the
// office Discord channel. A freelancer is told by email and in their own Discord channel, never in
// the office channel, which posting there would open to them.

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { assetComments } from "@/lib/db/schema/asset_comments";
import { auditLog } from "@/lib/db/schema/audit_log";
import { personnel } from "@/lib/db/schema/personnel";
import { teamNotifications } from "@/lib/db/schema/team_notifications";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { renderEmailLayout, EMAIL_TONE } from "@/lib/email/templates/email-layout";
import { appUrl } from "@/lib/app-url";
import { postToOfficeChannel } from "@/lib/discord/office-channel";
import { discordFetch, isConfigured as discordConfigured } from "@/lib/discord/discord-service";
import { listTeamMembers } from "@/lib/team-tasks/team-members";

// Discord embed colour for asset comment posts, as the decimal RGB value the API takes.
const EMBED_COLOR_ASSET_COMMENT = 0x2563eb;
// Lowercase role name of freelancers, as stored in personnel.roles.
const FREELANCER_ROLE = "artist";

export class AssetCommentError extends Error {}

/** Someone who can be @mentioned on an asset. `freelancer` is false for the full-time team. */
export interface MentionablePerson {
  id: string;
  name: string;
  email: string;
  discordUserId: string | null;
  freelancer: boolean;
}

export interface AssetCommentView {
  id: string;
  body: string;
  authorName: string | null;
  mentionedIds: string[];
  createdAt: Date;
}

/** The Board with this asset's card open (the card opens its drawer on ?asset=<sku>). */
export function assetCardUrl(sku: string): string {
  return appUrl(`/admin/board?asset=${encodeURIComponent(sku)}`);
}

async function findAsset(sku: string) {
  const [asset] = await db
    .select({ id: assets.id, sku: assets.sku, itemName: assets.itemName, currentArtistId: assets.currentArtistId })
    .from(assets)
    .where(eq(assets.sku, sku))
    .limit(1);
  if (!asset) throw new AssetCommentError(`Asset '${sku}' not found`);
  return asset;
}

/**
 * The people a comment on this asset can mention: the full-time team, then Active freelancers,
 * with the asset's own artist first among them.
 *
 * Input: the SKU. Output: the people, team first.
 */
export async function listMentionablePeople(sku: string): Promise<MentionablePerson[]> {
  const asset = await findAsset(sku);
  const [team, freelancers] = await Promise.all([
    listTeamMembers(),
    db
      .select({ id: personnel.id, name: personnel.name, email: personnel.email, discordUserId: personnel.discordUserId })
      .from(personnel)
      // Roles are stored in mixed case in places, so compared lowercase, as in team-members.ts.
      .where(and(eq(personnel.status, "Active"), sql`${FREELANCER_ROLE} = any (select lower(r) from unnest(${personnel.roles}) as r)`))
      .orderBy(asc(personnel.name)),
  ]);
  const teamIds = new Set(team.map((m) => m.id));
  const others = freelancers.filter((f) => !teamIds.has(f.id));
  others.sort((a, b) => Number(b.id === asset.currentArtistId) - Number(a.id === asset.currentArtistId));
  return [...team.map((m) => ({ ...m, freelancer: false })), ...others.map((f) => ({ ...f, freelancer: true }))];
}

/** Input: the SKU. Output: its comments, oldest first, with each author's name. */
export async function listAssetComments(sku: string): Promise<AssetCommentView[]> {
  const asset = await findAsset(sku);
  return db
    .select({
      id: assetComments.id,
      body: assetComments.body,
      authorName: personnel.name,
      mentionedIds: assetComments.mentionedIds,
      createdAt: assetComments.createdAt,
    })
    .from(assetComments)
    .leftJoin(personnel, eq(personnel.id, assetComments.authorId))
    .where(eq(assetComments.assetId, asset.id))
    .orderBy(asc(assetComments.createdAt), asc(assetComments.id));
}

/**
 * Adds a comment to an asset and tells everyone mentioned in it. Mentions of people who can't be
 * mentioned (inactive, or neither team nor freelancer) are dropped.
 *
 * Input: the SKU, the text, the mentioned people's ids and the author. Output: the comment's id.
 */
export async function addAssetComment(sku: string, body: string, mentionedIds: string[], actorId: string | null): Promise<string> {
  const asset = await findAsset(sku);
  const people = await listMentionablePeople(sku);
  const mentioned = people.filter((p) => mentionedIds.includes(p.id));

  const [comment] = await db
    .insert(assetComments)
    .values({ assetId: asset.id, authorId: actorId, body, mentionedIds: mentioned.map((p) => p.id) })
    .returning({ id: assetComments.id });
  await db.insert(auditLog).values({
    action: "commentAsset",
    entityType: "asset",
    entityId: asset.id,
    actorId,
    payload: { sku, commentId: comment.id, mentionedIds: mentioned.map((p) => p.id) },
  });

  const actorName = await authorName(actorId);
  const memberDiscordIds = people.filter((p) => !p.freelancer && p.discordUserId).map((p) => p.discordUserId as string);
  await Promise.all(
    mentioned
      .filter((p) => p.id !== actorId)
      .map((p) => notifyMention({ person: p, actorId, actorName, asset, quote: body, memberDiscordIds }))
  );
  return comment.id;
}

async function authorName(actorId: string | null): Promise<string> {
  if (!actorId) return "Someone";
  const [row] = await db.select({ name: personnel.name }).from(personnel).where(eq(personnel.id, actorId)).limit(1);
  return row?.name ?? "Someone";
}

/**
 * Tells one person they were mentioned. Never throws: a failed notice must not undo the comment,
 * and each way of telling them is tried on its own.
 */
async function notifyMention({
  person,
  actorId,
  actorName,
  asset,
  quote,
  memberDiscordIds,
}: {
  person: MentionablePerson;
  actorId: string | null;
  actorName: string;
  asset: { id: string; sku: string; itemName: string };
  quote: string;
  memberDiscordIds: string[];
}): Promise<void> {
  const sentence = `${actorName} mentioned you on ${asset.sku} "${asset.itemName}".`;
  // Freelancers can't open the Board; their own assets are on the artist page.
  const url = person.freelancer ? appUrl("/artist") : assetCardUrl(asset.sku);

  try {
    if (!person.freelancer) {
      await db.insert(teamNotifications).values({ recipientId: person.id, assetId: asset.id, kind: "mention", actorId, message: sentence });
    }
  } catch (error) {
    console.error("[asset comments] bell notice failed:", error);
  }

  const emailing = (async () => {
    try {
      await enqueueEmail({
        // A freelancer's notice joins the asset's existing email thread with them; the team's doesn't.
        assetId: person.freelancer ? asset.id : undefined,
        toEmail: person.email,
        subject: sentence,
        bodyHtml: renderEmailLayout({
          preheader: quote,
          eyebrow: "You were mentioned",
          tone: EMAIL_TONE.neutral,
          title: asset.itemName,
          meta: [asset.sku],
          imageUrl: null,
          stats: [],
          intro: `Hi ${person.name}, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`,
          quote: { label: actorName, text: quote },
          button: { label: person.freelancer ? "Open my tasks" : "Open the card", url },
          footer: "Sent by the Meta Fashion pipeline.",
        }),
      });
      await sendDueEmails();
    } catch (error) {
      console.error("[asset comments] email notice failed:", error);
    }
  })();

  const embed = { title: `${asset.sku} · ${asset.itemName}`, url, color: EMBED_COLOR_ASSET_COMMENT, description: quote };
  const posting = (async () => {
    if (!person.freelancer) {
      await postToOfficeChannel({
        content: person.discordUserId ? `<@${person.discordUserId}> ${sentence}` : `${person.name}: ${sentence}`,
        embeds: [embed],
        mentionDiscordIds: person.discordUserId ? [person.discordUserId] : [],
        memberDiscordIds,
      });
      return;
    }
    try {
      const channelId = await freelancerChannelId(person.id);
      if (!channelId || !discordConfigured()) return;
      await discordFetch(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: person.discordUserId ? `<@${person.discordUserId}> ${sentence}` : sentence,
          embeds: [embed],
          allowed_mentions: { users: person.discordUserId ? [person.discordUserId] : [] },
        }),
      });
    } catch (error) {
      console.error("[asset comments] freelancer Discord notice failed:", error);
    }
  })();

  await Promise.all([emailing, posting]);
}

async function freelancerChannelId(personnelId: string): Promise<string | null> {
  const [row] = await db.select({ channelId: personnel.discordChannelId }).from(personnel).where(eq(personnel.id, personnelId)).limit(1);
  return row?.channelId ?? null;
}
