// Priority cards. Anyone marks their own cards priority: the team (who assign artists) any card, and
// an artist the cards assigned to them. A priority card is highlighted on the board, and when
// someone other than the artist marks it, the bot messages the artist on Discord twice: a direct
// message and a post in their own channel.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { personnel } from "@/lib/db/schema/personnel";
import { discordFetch, isConfigured as isDiscordConfigured } from "@/lib/discord/discord-service";
import { resolveArtistChannelId } from "@/lib/discord/artist-channel";
import { appUrl } from "@/lib/app-url";

const MAX_PRIORITY_NOTE_CHARS = 300;
// Discord embed colour for a priority message, as the decimal RGB value the API takes.
const EMBED_COLOR_PRIORITY = 0xdc2626;

export class PriorityError extends Error {}
export class PriorityNotFoundError extends Error {}

export interface PriorityActor {
  personnelId: string | null;
  /** True for the team (canAssignArtists), who may mark any card. */
  isTeam: boolean;
}

export interface PriorityNotice {
  sku: string;
  itemName: string;
  note: string | null;
  markedByName: string;
  artistId: string;
  artistDiscordUserId: string | null;
  artistDiscordChannelId: string | null;
}

/** Sends a priority notice. Swappable so tests don't call Discord. */
export type PriorityNotifier = (notice: PriorityNotice) => Promise<{ dm: boolean; channel: boolean }>;

// Posts one priority message to a Discord channel (a DM channel or the artist's own channel).
async function postPriority(channelId: string, notice: PriorityNotice): Promise<void> {
  const mention = notice.artistDiscordUserId ? `<@${notice.artistDiscordUserId}> ` : "";
  await discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `${mention}${notice.markedByName} marked ${notice.sku} as a priority.`,
      embeds: [
        {
          title: `Priority: ${notice.itemName} (${notice.sku})`,
          description: notice.note ?? "Please work on this one first.",
          url: appUrl(`/artist?asset=${encodeURIComponent(notice.sku)}`),
          color: EMBED_COLOR_PRIORITY,
        },
      ],
    }),
  });
}

/**
 * Messages the artist on Discord: a direct message and a post in their channel. Each is
 * best-effort: no linked account, DMs turned off or Discord being down skips that one message.
 */
export const DISCORD_PRIORITY_NOTIFIER: PriorityNotifier = async (notice) => {
  const sent = { dm: false, channel: false };
  if (!isDiscordConfigured()) return sent;
  if (notice.artistDiscordUserId) {
    try {
      const dm = await discordFetch<{ id: string }>("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: notice.artistDiscordUserId }) });
      await postPriority(dm.id, notice);
      sent.dm = true;
    } catch (error) {
      console.error("[priority] Discord DM failed:", error);
    }
  }
  try {
    const channelId = await resolveArtistChannelId({ id: notice.artistId, discordUserId: notice.artistDiscordUserId, discordChannelId: notice.artistDiscordChannelId });
    if (channelId) {
      await postPriority(channelId, notice);
      sent.channel = true;
    }
  } catch (error) {
    console.error("[priority] Discord channel post failed:", error);
  }
  return sent;
};

/**
 * Marks a card priority, or takes the mark off.
 *
 * Input: the SKU, on or off, an optional note, who is doing it and (for tests) the notifier.
 * Output: whether the artist was messaged by DM and in their channel. Throws PriorityNotFoundError
 * for an unknown SKU and PriorityError when the actor may not mark this card.
 */
export async function setCardPriority(
  sku: string,
  input: { priority: boolean; note?: string | null },
  actor: PriorityActor,
  notifier: PriorityNotifier = DISCORD_PRIORITY_NOTIFIER
): Promise<{ dm: boolean; channel: boolean }> {
  const [row] = await db
    .select({ id: assets.id, itemName: assets.itemName, artistId: assets.currentArtistId, priorityAt: assets.priorityAt, discordUserId: personnel.discordUserId, discordChannelId: personnel.discordChannelId })
    .from(assets)
    .leftJoin(personnel, eq(personnel.id, assets.currentArtistId))
    .where(eq(assets.sku, sku))
    .limit(1);
  if (!row) throw new PriorityNotFoundError(`Asset '${sku}' not found`);
  const isOwnCard = Boolean(actor.personnelId && row.artistId === actor.personnelId);
  if (!actor.isTeam && !isOwnCard) throw new PriorityError("You can only mark your own cards as a priority");

  const note = input.note?.trim().slice(0, MAX_PRIORITY_NOTE_CHARS) || null;
  await db
    .update(assets)
    .set(input.priority ? { priorityAt: new Date(), priorityBy: actor.personnelId, priorityNote: note } : { priorityAt: null, priorityBy: null, priorityNote: null })
    .where(eq(assets.id, row.id));
  await db.insert(auditLog).values({ action: input.priority ? "markPriority" : "clearPriority", entityType: "asset", entityId: row.id, actorId: actor.personnelId, payload: { sku, note } });

  // Only a newly marked card messages the artist, and never when the artist marked it themselves.
  if (!input.priority || row.priorityAt || !row.artistId || isOwnCard) return { dm: false, channel: false };
  const [marker] = actor.personnelId ? await db.select({ name: personnel.name }).from(personnel).where(eq(personnel.id, actor.personnelId)).limit(1) : [];
  return notifier({ sku, itemName: row.itemName, note, markedByName: marker?.name ?? "The team", artistId: row.artistId, artistDiscordUserId: row.discordUserId, artistDiscordChannelId: row.discordChannelId });
}
