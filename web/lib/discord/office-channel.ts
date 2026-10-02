import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import {
  classifyRoleName,
  createChannel,
  discordFetch,
  FULL_CHANNEL_ACCESS_BITS,
  getGuildChannels,
  getGuildRoles,
  isConfigured,
  putChannelPermission,
  VIEW_CHANNEL_BIT,
  type DiscordOverwrite,
} from "./discord-service";

// The private channel where Team Tasks posts @mentions, tasks given to someone, and the 7 pm
// summary. Named like the server's other shared channels ("🎬│animation-concepts").
export const OFFICE_CHANNEL_NAME = "🏢│office";
// The channel's id once made, so it is found again without matching on its name.
const OFFICE_CHANNEL_SETTING_KEY = "discord_office_channel_id";
// Discord permission overwrite types.
const ROLE_OVERWRITE = 0;
const MEMBER_OVERWRITE = 1;

async function savedOfficeChannelId(): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, OFFICE_CHANNEL_SETTING_KEY)).limit(1);
  return typeof row?.value === "string" ? row.value : null;
}

async function saveOfficeChannelId(channelId: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: OFFICE_CHANNEL_SETTING_KEY, value: channelId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: channelId, updatedAt: new Date() } });
  await db.insert(auditLog).values({
    action: "saveOfficeChannel",
    entityType: "app_setting",
    entityId: OFFICE_CHANNEL_SETTING_KEY,
    payload: { channelId },
  });
}

/**
 * The office channel's id. Made the first time it is needed: a private text channel that only the
 * server's Admin role and the full-time team can see. A channel already named for it is adopted
 * instead of making a second.
 *
 * Input: the Discord user ids of the full-time team. Output: the channel id, or null when Discord
 * isn't configured.
 */
export async function ensureOfficeChannel(memberDiscordIds: string[]): Promise<string | null> {
  if (!isConfigured()) return null;
  const [saved, channels] = await Promise.all([savedOfficeChannelId(), getGuildChannels()]);
  if (saved && channels.some((c) => c.id === saved)) return saved;

  const existing = channels.find((c) => c.name === OFFICE_CHANNEL_NAME);
  if (existing) {
    await saveOfficeChannelId(existing.id);
    return existing.id;
  }

  const guildId = process.env.DISCORD_GUILD_ID as string;
  const adminRole = (await getGuildRoles()).find((r) => classifyRoleName(r.name) === "admin");
  const overwrites: DiscordOverwrite[] = [
    { id: guildId, type: ROLE_OVERWRITE, allow: "0", deny: VIEW_CHANNEL_BIT.toString() },
    ...memberDiscordIds.map((id) => ({ id, type: MEMBER_OVERWRITE as 0 | 1, allow: FULL_CHANNEL_ACCESS_BITS.toString(), deny: "0" })),
  ];
  if (adminRole) overwrites.push({ id: adminRole.id, type: ROLE_OVERWRITE, allow: FULL_CHANNEL_ACCESS_BITS.toString(), deny: "0" });
  const channel = await createChannel(OFFICE_CHANNEL_NAME, null, overwrites, "Team Tasks: @mentions, tasks given to someone, and the 7 pm summary.");
  await saveOfficeChannelId(channel.id);
  return channel.id;
}

// Gives each person view and post access to the channel. Discord replaces a member's overwrite on
// PUT, so running it again changes nothing.
async function grantOfficeAccess(channelId: string, discordUserIds: string[]): Promise<void> {
  for (const userId of discordUserIds) {
    await putChannelPermission(channelId, userId, MEMBER_OVERWRITE, FULL_CHANNEL_ACCESS_BITS, BigInt(0));
  }
}

/**
 * Makes the office channel if it doesn't exist yet and gives everyone on the full-time team access,
 * including people who joined the team after it was made.
 *
 * Input: the full-time team's Discord user ids. Output: the channel's link, or null when Discord
 * isn't configured.
 */
export async function setUpOfficeChannel(memberDiscordIds: string[]): Promise<string | null> {
  const channelId = await ensureOfficeChannel(memberDiscordIds);
  if (!channelId) return null;
  await grantOfficeAccess(channelId, memberDiscordIds);
  return `https://discord.com/channels/${process.env.DISCORD_GUILD_ID}/${channelId}`;
}

export interface OfficeMessage {
  content: string;
  embeds?: Record<string, unknown>[];
  /** Discord user ids to ping. */
  mentionDiscordIds: string[];
  /**
   * The full-time team's Discord user ids. Each is given access before the post, so someone added
   * to the team later can read the channel, and a ping reaches them.
   */
  memberDiscordIds: string[];
}

/**
 * Posts to the office channel, pinging the people mentioned. Best-effort: Discord being unset or
 * down means no Discord message, never a failed action.
 */
export async function postToOfficeChannel(message: OfficeMessage): Promise<void> {
  try {
    const channelId = await ensureOfficeChannel(message.memberDiscordIds);
    if (!channelId) return;
    await grantOfficeAccess(channelId, [...new Set([...message.memberDiscordIds, ...message.mentionDiscordIds])]);
    await discordFetch(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: message.content,
        embeds: message.embeds ?? [],
        allowed_mentions: { users: message.mentionDiscordIds },
      }),
    });
  } catch (error) {
    console.error("[team tasks] office channel post failed:", error);
  }
}
