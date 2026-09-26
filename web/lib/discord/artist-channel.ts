import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { and, eq, isNull, sql } from "drizzle-orm";
import { discordFetch, getGuildChannels, getGuildRoles, isConfigured, VIEW_CHANNEL_BIT, type DiscordGuildMember } from "./discord-service";

// Discord's channel type for an ordinary text channel.
const TEXT_CHANNEL_TYPE = 0;
// Discord's permission overwrite type for a single member, as opposed to a role (0).
const MEMBER_OVERWRITE_TYPE = 1;
// Every artist's private channel is opened to a role named "Artist: {Name}" (see onboardMember).
const ARTIST_ROLE_PREFIX = "artist:";

function grantsView(allow: string): boolean {
  return (BigInt(allow) & VIEW_CHANNEL_BIT) === VIEW_CHANNEL_BIT;
}

/**
 * Finds the private text channel a Discord member works in: the channel opened to one of their
 * "Artist: …" roles, or to them directly.
 *
 * Input: the member's Discord user id. Output: the channel id, or null when they are not in the
 * server or no channel is opened to them.
 */
export async function findArtistChannelId(discordUserId: string): Promise<string | null> {
  let member: DiscordGuildMember;
  try {
    member = await discordFetch<DiscordGuildMember>(`/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}`);
  } catch {
    return null;
  }
  const [channels, roles] = await Promise.all([getGuildChannels(), getGuildRoles()]);
  const artistRoleIds = new Set(
    roles.filter((r) => member.roles.includes(r.id) && r.name.toLowerCase().startsWith(ARTIST_ROLE_PREFIX)).map((r) => r.id)
  );
  const textChannels = channels.filter((c) => c.type === TEXT_CHANNEL_TYPE);
  const byRole = textChannels.find((c) => (c.permission_overwrites || []).some((o) => artistRoleIds.has(o.id) && grantsView(o.allow)));
  if (byRole) return byRole.id;
  const byMember = textChannels.find((c) =>
    (c.permission_overwrites || []).some((o) => o.type === MEMBER_OVERWRITE_TYPE && o.id === discordUserId && grantsView(o.allow))
  );
  return byMember?.id ?? null;
}

async function saveChannelLink(personnelId: string, channelId: string, source: string): Promise<void> {
  await db.update(personnel).set({ discordChannelId: channelId, updatedAt: new Date() }).where(eq(personnel.id, personnelId));
  await db.insert(auditLog).values({
    action: "linkDiscordChannel",
    entityType: "personnel",
    entityId: personnelId,
    actorId: null,
    payload: { channelId, source },
  });
}

/**
 * Saves a newly created artist channel on the personnel record of the Discord member it was made
 * for. Called by onboardMember; a member with no personnel record yet is linked later, when their
 * record is approved or by linkMissingArtistChannels.
 */
export async function linkChannelToDiscordUser(discordUserId: string, channelId: string): Promise<void> {
  const rows = await db.select({ id: personnel.id }).from(personnel).where(eq(personnel.discordUserId, discordUserId));
  for (const row of rows) await saveChannelLink(row.id, channelId, "onboardMember");
}

/**
 * Returns a person's Discord channel id, looking it up in Discord and saving it when the record has
 * a Discord user id but no channel yet. Never throws: a Discord failure means null.
 */
export async function resolveArtistChannelId(person: {
  id: string;
  discordUserId: string | null;
  discordChannelId: string | null;
}): Promise<string | null> {
  if (person.discordChannelId) return person.discordChannelId;
  if (!person.discordUserId || !isConfigured()) return null;
  try {
    const channelId = await findArtistChannelId(person.discordUserId);
    if (channelId) await saveChannelLink(person.id, channelId, "lookup");
    return channelId;
  } catch (error) {
    console.error("[discord] channel lookup failed:", error);
    return null;
  }
}

export interface ChannelLinkReport {
  linked: { name: string; channelId: string }[];
  missing: { name: string; reason: string }[];
}

/**
 * Links every Active artist that has no Discord channel saved, where Discord has one for them.
 *
 * Output: who was linked, and who is still missing and why, for the admin to fix in the Discord
 * Team Manager.
 */
export async function linkMissingArtistChannels(): Promise<ChannelLinkReport> {
  const rows = await db
    .select({ id: personnel.id, name: personnel.name, discordUserId: personnel.discordUserId })
    .from(personnel)
    .where(
      and(
        eq(personnel.status, "Active"),
        isNull(personnel.discordChannelId),
        sql`EXISTS (SELECT 1 FROM unnest(${personnel.roles}) AS r WHERE lower(r) = 'artist')`
      )
    );
  const report: ChannelLinkReport = { linked: [], missing: [] };
  if (!isConfigured()) {
    report.missing = rows.map((r) => ({ name: r.name, reason: "Discord is not set up on this deployment." }));
    return report;
  }
  for (const row of rows) {
    if (!row.discordUserId) {
      report.missing.push({ name: row.name, reason: "No Discord account linked. Approve their Discord onboarding request or onboard them in the Discord Team Manager." });
      continue;
    }
    const channelId = await findArtistChannelId(row.discordUserId);
    if (channelId) {
      await saveChannelLink(row.id, channelId, "linkMissingArtistChannels");
      report.linked.push({ name: row.name, channelId });
    } else {
      report.missing.push({ name: row.name, reason: "In Discord, but no channel is opened to them. Onboard them in the Discord Team Manager to create one." });
    }
  }
  return report;
}
