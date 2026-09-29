import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  discordFetch,
  getGuildChannels,
  getGuildMembers,
  getGuildRoles,
  isConfigured,
  VIEW_CHANNEL_BIT,
  type DiscordChannel,
  type DiscordGuildMember,
  type DiscordRole,
} from "./discord-service";

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

/**
 * Works out whose private channel this is: the only member holding an "Artist: …" role the
 * channel is opened to, or, when no artist role opens it, the only member it is opened to directly.
 * The role comes first because temporary access grants add member-level access for other people.
 *
 * Input: the channel, and the server's roles and members. Output: that member's user id, or null
 * when no single person can be identified.
 */
export function pickChannelMember(
  channel: Pick<DiscordChannel, "permission_overwrites">,
  roles: Pick<DiscordRole, "id" | "name">[],
  members: DiscordGuildMember[]
): string | null {
  const overwrites = (channel.permission_overwrites || []).filter((o) => grantsView(o.allow));
  const artistRoleIds = new Set(
    roles.filter((r) => r.name.toLowerCase().startsWith(ARTIST_ROLE_PREFIX) && overwrites.some((o) => o.id === r.id)).map((r) => r.id)
  );
  if (artistRoleIds.size > 0) {
    const holders = members.filter((m) => !m.user.bot && m.roles.some((id) => artistRoleIds.has(id)));
    return holders.length === 1 ? holders[0].user.id : null;
  }
  const memberIds = new Set(overwrites.filter((o) => o.type === MEMBER_OVERWRITE_TYPE).map((o) => o.id));
  return memberIds.size === 1 ? [...memberIds][0] : null;
}

/** The Discord user a private artist channel belongs to, or null when it can't be told. */
async function findChannelMemberId(channelId: string): Promise<string | null> {
  const [channels, roles, members] = await Promise.all([getGuildChannels(), getGuildRoles(), getGuildMembers()]);
  const channel = channels.find((c) => c.id === channelId);
  return channel ? pickChannelMember(channel, roles, members) : null;
}

// Saves a Discord account and/or channel on a personnel record, with one audit entry per field.
async function saveDiscordLink(personnelId: string, link: { discordUserId?: string; channelId?: string }, source: string): Promise<void> {
  await db
    .update(personnel)
    .set({
      ...(link.discordUserId ? { discordUserId: link.discordUserId } : {}),
      ...(link.channelId ? { discordChannelId: link.channelId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(personnel.id, personnelId));
  const entries = [
    ...(link.discordUserId ? [{ action: "linkDiscordUser", payload: { discordUserId: link.discordUserId, source } }] : []),
    ...(link.channelId ? [{ action: "linkDiscordChannel", payload: { channelId: link.channelId, source } }] : []),
  ];
  if (entries.length > 0) {
    await db.insert(auditLog).values(entries.map((e) => ({ ...e, entityType: "personnel", entityId: personnelId, actorId: null })));
  }
}

/**
 * Links a member just onboarded in the Discord Team Manager to their pipeline record, saving both
 * their Discord account and their new channel. The record is the one the admin picked; failing
 * that, the record already carrying their Discord id; failing that, the only Active person with
 * exactly that name and no Discord account yet.
 *
 * Input: the picked personnel id (optional), the name typed on the form, the member's Discord user
 * id and the new channel id. Output: who was linked, or null when no record could be found.
 */
export async function linkOnboardedMember(input: {
  personnelId?: string;
  name: string;
  discordUserId: string;
  channelId: string;
}): Promise<{ id: string; name: string } | null> {
  const columns = { id: personnel.id, name: personnel.name };
  let [target] = input.personnelId
    ? await db.select(columns).from(personnel).where(eq(personnel.id, input.personnelId)).limit(1)
    : [];
  if (!target) {
    [target] = await db.select(columns).from(personnel).where(eq(personnel.discordUserId, input.discordUserId)).limit(1);
  }
  if (!target) {
    const sameName = await db
      .select(columns)
      .from(personnel)
      .where(
        and(
          eq(personnel.status, "Active"),
          isNull(personnel.discordUserId),
          sql`lower(${personnel.name}) = ${input.name.trim().toLowerCase()}`
        )
      );
    // Two people with the same name can't be told apart, so neither is linked.
    if (sameName.length === 1) target = sameName[0];
  }
  if (!target) return null;
  await saveDiscordLink(target.id, { discordUserId: input.discordUserId, channelId: input.channelId }, "onboardMember");
  return target;
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
    if (channelId) await saveDiscordLink(person.id, { channelId }, "lookup");
    return channelId;
  } catch (error) {
    console.error("[discord] channel lookup failed:", error);
    return null;
  }
}

export interface ChannelLinkReport {
  /** Artists whose channel was found and saved. */
  linked: { name: string; channelId: string }[];
  /** Artists whose Discord account was found from their channel and saved. */
  accountsLinked: { name: string; discordUserId: string }[];
  missing: { name: string; reason: string }[];
}

/**
 * Completes every Active artist's Discord link that is half done: finds the channel of someone
 * whose Discord account is known, and the Discord account of someone whose channel is known. Runs
 * daily with the email cron and from Personnel → Link Discord channels.
 *
 * Output: what was linked, and who is still missing what and why, for the admin to fix.
 */
export async function linkMissingArtistChannels(): Promise<ChannelLinkReport> {
  const rows = await db
    .select({ id: personnel.id, name: personnel.name, discordUserId: personnel.discordUserId, discordChannelId: personnel.discordChannelId })
    .from(personnel)
    .where(
      and(
        eq(personnel.status, "Active"),
        or(isNull(personnel.discordChannelId), isNull(personnel.discordUserId)),
        sql`EXISTS (SELECT 1 FROM unnest(${personnel.roles}) AS r WHERE lower(r) = 'artist')`
      )
    );
  const report: ChannelLinkReport = { linked: [], accountsLinked: [], missing: [] };
  if (!isConfigured()) {
    report.missing = rows.map((r) => ({ name: r.name, reason: "Discord is not set up on this deployment." }));
    return report;
  }
  for (const row of rows) {
    if (!row.discordUserId && !row.discordChannelId) {
      report.missing.push({ name: row.name, reason: "No Discord account or channel linked. Onboard them in the Discord Team Manager and pick their pipeline account." });
      continue;
    }
    if (!row.discordChannelId && row.discordUserId) {
      const channelId = await findArtistChannelId(row.discordUserId);
      if (channelId) {
        await saveDiscordLink(row.id, { channelId }, "linkMissingArtistChannels");
        report.linked.push({ name: row.name, channelId });
      } else {
        report.missing.push({ name: row.name, reason: "In Discord, but no channel is opened to them. Onboard them in the Discord Team Manager to create one." });
      }
      continue;
    }
    if (!row.discordUserId && row.discordChannelId) {
      const discordUserId = await findChannelMemberId(row.discordChannelId);
      if (discordUserId) {
        await saveDiscordLink(row.id, { discordUserId }, "linkMissingArtistChannels");
        report.accountsLinked.push({ name: row.name, discordUserId });
      } else {
        report.missing.push({
          name: row.name,
          reason: "Their channel is linked, but it doesn't show whose it is, so Discord messages don't @mention them. Add their Discord user id, or onboard them in the Discord Team Manager.",
        });
      }
    }
  }
  return report;
}
