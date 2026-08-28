// lib/discord/team-service.ts
// Higher-level Discord Team Manager orchestration — write actions
// (onboarding, permission changes, archive/restore, kicks, temp access).
// Faithfully ported from Catalog Intel's own proven server/server.cjs
// routes (same request shapes, same business logic, same real incidents
// referenced inline), not reimplemented from scratch. discord-service.ts
// holds the low-level REST primitives this file composes; that separation
// mirrors kanban-service.ts vs assignment-service.ts elsewhere in this app.
//
// One real behavioral difference from the original: temp access grants are
// stored in the discord_temp_access table (this app has a real database)
// instead of a JSON file — same shape, same restore-on-revoke logic.

import { db } from "@/lib/db/client";
import { discordTempAccess } from "@/lib/db/schema/discord_temp_access";
import { eq, lte } from "drizzle-orm";
import {
  discordFetch,
  isConfigured,
  getGuildMembers,
  getGuildChannels,
  getGuildRoles,
  classifyRoleName,
  searchMembers,
  createRole,
  assignRole,
  createChannel,
  patchChannel,
  deleteChannel,
  putChannelPermission,
  deleteChannelPermission,
  mergeOverwriteBit,
  sendMessage,
  pinMessage,
  kickMember,
  CATEGORY_CHANNEL_TYPE,
  DEPARTMENT_RULES,
  NEW_CHANNEL_MESSAGE_TEMPLATE,
  FULL_CHANNEL_ACCESS_BITS,
  VIEW_CHANNEL_BIT,
  SEND_MESSAGES_BIT,
  ATTACH_FILES_BIT,
  EMBED_LINKS_BIT,
  READ_MESSAGE_HISTORY_BIT,
  type DiscordChannel,
  type DiscordRole,
  type DiscordOverwrite,
  type DiscordApiError,
  type DiscordGuildMember,
} from "./discord-service";

// ─── Overview (shared by the server-rendered page and its client refetch) ──

export interface OverviewMember {
  id: string;
  username: string;
  rawUsername: string;
  displayName: string;
  roles: string[];
  buckets: string[];
  channels: string[];
  status: "active" | "pending";
}

export interface OverviewChannel {
  id: string;
  name: string;
  type: number;
  category: string | null;
  categoryId: string | null;
  isArchived: boolean;
  bucketVisibility: Record<"admin" | "manager" | "curator" | "artist", boolean>;
}

export interface DiscordOverview {
  members: OverviewMember[];
  channels: OverviewChannel[];
  archived: OverviewChannel[];
  categories: { id: string; name: string }[];
}

// Real Discord permission-overwrite resolution for VIEW_CHANNEL, ported
// verbatim from server.cjs's own canViewChannel. Role overwrites only — the
// whole panel is role-based, no per-member overwrites appear anywhere in
// the brief/spec this was built against.
export function canViewChannel(channel: DiscordChannel, memberRoleIds: string[], everyoneRoleId: string): boolean {
  const overwrites: DiscordOverwrite[] = channel.permission_overwrites || [];
  const byId = new Map(overwrites.map((o) => [o.id, o]));

  let allowed = false;
  const everyone = byId.get(everyoneRoleId);
  if (everyone) {
    if (BigInt(everyone.deny) & VIEW_CHANNEL_BIT) allowed = false;
    if (BigInt(everyone.allow) & VIEW_CHANNEL_BIT) allowed = true;
  } else {
    allowed = true;
  }

  let roleAllow = false;
  let roleDeny = false;
  for (const roleId of memberRoleIds) {
    const ow = byId.get(roleId);
    if (!ow) continue;
    if (BigInt(ow.allow) & VIEW_CHANNEL_BIT) roleAllow = true;
    if (BigInt(ow.deny) & VIEW_CHANNEL_BIT) roleDeny = true;
  }
  if (roleDeny) allowed = false;
  if (roleAllow) allowed = true;

  return allowed;
}

export async function getDiscordOverview(): Promise<DiscordOverview> {
  const [members, channels, roles] = await Promise.all([getGuildMembers(), getGuildChannels(), getGuildRoles()]);

  const guildId = process.env.DISCORD_GUILD_ID as string;
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const categoriesById = new Map(channels.filter((c) => c.type === CATEGORY_CHANNEL_TYPE).map((c) => [c.id, c]));
  const nonCategoryChannels = channels.filter((c) => c.type !== CATEGORY_CHANNEL_TYPE);

  const outChannels: OverviewChannel[] = nonCategoryChannels.map((c) => {
    const category = c.parent_id ? categoriesById.get(c.parent_id) : undefined;
    const bucketRoleIds: Record<string, string[]> = { admin: [], manager: [], curator: [], artist: [] };
    roles.forEach((r) => {
      const bucket = classifyRoleName(r.name);
      if (bucket) bucketRoleIds[bucket].push(r.id);
    });
    const bucketVisibility = {} as OverviewChannel["bucketVisibility"];
    for (const [bucket, ids] of Object.entries(bucketRoleIds)) {
      bucketVisibility[bucket as keyof OverviewChannel["bucketVisibility"]] = ids.length > 0 && ids.some((id) => canViewChannel(c, [id], guildId));
    }
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      category: category ? category.name : null,
      categoryId: category ? category.id : null,
      isArchived: category ? category.name === "📦 Archive" : false,
      bucketVisibility,
    };
  });

  const outMembers: OverviewMember[] = members
    .filter((m) => !m.user.bot)
    .map((m) => {
      const memberRoles = (m.roles || []).map((id) => roleById.get(id)).filter((r): r is DiscordRole => Boolean(r));
      const buckets = new Set(memberRoles.map((r) => classifyRoleName(r.name)).filter((b): b is NonNullable<typeof b> => b !== null));
      const visibleChannelNames = nonCategoryChannels
        .filter((c) => canViewChannel(c, m.roles || [], guildId))
        .map((c) => c.name);
      return {
        id: m.user.id,
        username: m.nick || m.user.global_name || m.user.username,
        rawUsername: m.user.username,
        displayName: m.nick || m.user.global_name || m.user.username,
        roles: memberRoles.map((r) => r.name),
        buckets: [...buckets] as string[],
        channels: visibleChannelNames,
        status: buckets.size > 0 ? ("active" as const) : ("pending" as const),
      };
    });

  return {
    members: outMembers,
    channels: outChannels,
    archived: outChannels.filter((c) => c.isArchived),
    categories: [...categoriesById.values()]
      .filter((cat) => cat.name !== "📦 Archive")
      .map((cat) => ({ id: cat.id, name: cat.name })),
  };
}

// ─── Departments ─────────────────────────────────────────────────────────

export function getDepartments() {
  return Object.entries(DEPARTMENT_RULES).map(([name, rules]) => ({
    name,
    emoji: rules.emoji,
    sharedChannelName: rules.sharedChannelName,
    sharedLabel: rules.sharedChannelName ? `Also add to ${rules.sharedChannelName}?` : null,
    // Animations defaults NO, everyone else with a shared channel defaults YES, per spec.
    sharedDefault: rules.sharedRoleName ? false : true,
  }));
}

// ─── Onboarding ──────────────────────────────────────────────────────────

export interface OnboardOptions {
  name: string;
  username: string;
  department: string;
  alsoAddShared?: boolean;
  managerVisible?: boolean;
}

// Discord's member-search does prefix matching, so it can return several
// candidates — require an EXACT match rather than silently falling back to
// "closest" result. Onboarding assigns a real role, creates a real channel,
// and grants server access; guessing wrong onboards the wrong person into
// someone else's private channel.
//
// Match against username, global_name (display name), AND nick — not just
// username. Real-world discovery (2026-08-27, live server): every artist's
// actual @username is a cryptic handle unrelated to how the team refers to
// them (e.g. "Anuj" the artist is @anuj_shadow, "Sanjay" is @sanjay3darts,
// "Bhaswar" is @bhaswar_77835) — the same display names the server's own
// "Artist: X" roles already use. Requiring the raw username with no
// fallback meant onboarding failed for anyone who typed the name they
// actually know the person by, with no visible explanation beyond a toast.
// Still an exact match, just against three fields instead of one, so the
// "no guessing" safety property holds. Exported as a pure function so this
// matching rule is covered by a real unit test, not just live Discord calls.
export function findExactMemberMatch(members: DiscordGuildMember[], query: string): DiscordGuildMember | undefined {
  const needle = query.toLowerCase();
  return members.find(
    (m) =>
      m.user.username.toLowerCase() === needle ||
      (m.user.global_name && m.user.global_name.toLowerCase() === needle) ||
      (m.nick && m.nick.toLowerCase() === needle)
  );
}

export async function onboardMember(options: OnboardOptions) {
  const { name, username, department, alsoAddShared, managerVisible } = options;
  const rules = DEPARTMENT_RULES[department];
  if (!rules) throw new Error(`Unknown department "${department}".`);

  const matches = await searchMembers(username);
  const match = findExactMemberMatch(matches || [], username);
  if (!match) {
    const close = (matches || []).slice(0, 5).map((m) => m.user.global_name || m.nick || m.user.username);
    throw new Error(
      `No member found matching "${username}" — try their Discord display name or username exactly, and make sure they're already in the server.${
        close.length ? ` Close matches: ${close.join(", ")}.` : ""
      }`
    );
  }

  const [channels, roles] = await Promise.all([getGuildChannels(), getGuildRoles()]);
  const category = channels.find((c) => c.type === CATEGORY_CHANNEL_TYPE && c.name === rules.categoryName);
  if (!category) throw new Error(`Category "${rules.categoryName}" not found on the server — check it hasn't been renamed.`);
  const guildId = process.env.DISCORD_GUILD_ID as string;
  const adminRole = roles.find((r) => classifyRoleName(r.name) === "admin");
  const managerRole = roles.find((r) => classifyRoleName(r.name) === "manager");

  const artistRole = await createRole(`Artist: ${name}`, 0x3498db);
  await assignRole(match.user.id, artistRole.id);

  const overwrites: DiscordOverwrite[] = [
    { id: guildId, type: 0, allow: "0", deny: VIEW_CHANNEL_BIT.toString() },
    { id: artistRole.id, type: 0, allow: FULL_CHANNEL_ACCESS_BITS.toString(), deny: "0" },
  ];
  if (adminRole) overwrites.push({ id: adminRole.id, type: 0, allow: FULL_CHANNEL_ACCESS_BITS.toString(), deny: "0" });
  const showToManager = managerVisible === undefined ? rules.managerSees : !!managerVisible;
  if (managerRole && showToManager) overwrites.push({ id: managerRole.id, type: 0, allow: FULL_CHANNEL_ACCESS_BITS.toString(), deny: "0" });

  const channelSlug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const channelName = `${rules.emoji}│${channelSlug}`;
  const newChannel = await createChannel(channelName, category.id, overwrites);

  // Shared-channel access: Animations grants an existing role (that role
  // already has view access baked into animation-concepts' own
  // overwrites); everyone else grants the new artist role direct view
  // access on the shared channel itself.
  if (alsoAddShared && rules.sharedChannelName) {
    if (rules.sharedRoleName) {
      const sharedRole = roles.find((r) => r.name === rules.sharedRoleName);
      if (sharedRole) await assignRole(match.user.id, sharedRole.id);
    } else {
      const sharedChannel = channels.find((c) => c.name === rules.sharedChannelName);
      if (sharedChannel) {
        const existingOv = (sharedChannel.permission_overwrites || []).find((o) => o.id === artistRole.id);
        const { allow, deny } = mergeOverwriteBit(existingOv, FULL_CHANNEL_ACCESS_BITS, true);
        await putChannelPermission(sharedChannel.id, artistRole.id, 0, allow, deny);
      }
    }
  }

  const msg = await sendMessage(newChannel.id, NEW_CHANNEL_MESSAGE_TEMPLATE(`<@${match.user.id}>`, department));
  await pinMessage(newChannel.id, msg.id).catch((e: Error) => console.error("[discord] pin failed (channel still created fine):", e.message));

  return {
    channel: { id: newChannel.id, name: newChannel.name, url: `https://discord.com/channels/${guildId}/${newChannel.id}` },
    role: { id: artistRole.id, name: artistRole.name },
  };
}

// ─── Channel permissions (bucket toggle + bit-level detail) ────────────────

export async function setChannelBucketPermission(channelId: string, bucket: "manager" | "curator", enabled: boolean) {
  const roles = await getGuildRoles();
  // "curator" maps to TWO distinct real roles (Concept Curation Manager AND
  // Animation Team) — apply to every matching role, not just the first
  // found, or toggling "Curator" would silently only affect whichever role
  // happened to come first and leave the other one's access untouched.
  const targetRoles = roles.filter((r) => classifyRoleName(r.name) === bucket);
  if (targetRoles.length === 0) throw new Error(`No role found for bucket "${bucket}".`);

  const channels = await getGuildChannels();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) throw new Error("Channel not found.");

  for (const targetRole of targetRoles) {
    const existingOv = (channel.permission_overwrites || []).find((o) => o.id === targetRole.id);
    const { allow, deny } = mergeOverwriteBit(existingOv, FULL_CHANNEL_ACCESS_BITS, enabled);
    await putChannelPermission(channelId, targetRole.id, 0, allow, deny);
  }
}

// Bit-level permission detail, per the real report that motivated it in
// Catalog Intel's own version: the simple bucket toggle above ("can Manager
// see this channel") is all-or-nothing, so a gap like "can view and send
// text but not attach images" (the FULL_CHANNEL_ACCESS_BITS incident
// documented in discord-service.ts) was invisible until someone hit it.
const DISCORD_PERMISSION_BIT_MAP: Record<string, bigint> = {
  view: VIEW_CHANNEL_BIT,
  send: SEND_MESSAGES_BIT,
  attach: ATTACH_FILES_BIT,
  embed: EMBED_LINKS_BIT,
  history: READ_MESSAGE_HISTORY_BIT,
};

export interface ChannelPermissionRow {
  roleId: string;
  roleName: string;
  isEveryone: boolean;
  bits: Record<string, boolean>;
}

export async function getChannelPermissionDetail(channelId: string) {
  const [channels, roles] = await Promise.all([getGuildChannels(), getGuildRoles()]);
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) throw new Error("Channel not found.");
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const guildId = process.env.DISCORD_GUILD_ID as string;

  const rows: ChannelPermissionRow[] = (channel.permission_overwrites || [])
    .filter((ow) => ow.type === 0) // role overwrites only
    .map((ow) => {
      const isEveryone = ow.id === guildId;
      const role = isEveryone ? null : roleById.get(ow.id);
      const allow = BigInt(ow.allow);
      const bits: Record<string, boolean> = {};
      for (const [key, bit] of Object.entries(DISCORD_PERMISSION_BIT_MAP)) bits[key] = !!(allow & bit);
      return { roleId: ow.id, roleName: isEveryone ? "@everyone" : role ? role.name : ow.id, isEveryone, bits };
    })
    .sort((a: ChannelPermissionRow, b: ChannelPermissionRow) =>
      a.isEveryone ? -1 : b.isEveryone ? 1 : a.roleName.localeCompare(b.roleName)
    );

  return { channelId: channel.id, channelName: channel.name, rows };
}

export async function setChannelPermissionBit(channelId: string, roleId: string, bit: string, enabled: boolean) {
  const targetBit = DISCORD_PERMISSION_BIT_MAP[bit];
  if (!targetBit) throw new Error(`bit must be one of ${Object.keys(DISCORD_PERMISSION_BIT_MAP).join("|")}.`);
  const channels = await getGuildChannels();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) throw new Error("Channel not found.");
  const existingOv = (channel.permission_overwrites || []).find((o) => o.id === roleId);
  const { allow, deny } = mergeOverwriteBit(existingOv, targetBit, enabled);
  await putChannelPermission(channelId, roleId, 0, allow, deny);
}

// ─── Archive / restore / delete ─────────────────────────────────────────

// Returns the category the channel lived in before archiving (null if it
// had none, or if it was already sitting in Archive — callers that persist
// this to restore later must not overwrite a real prior category with
// "Archive" itself from a redundant second archive call).
export async function archiveChannel(channelId: string): Promise<{ priorCategoryId: string | null }> {
  const channels = await getGuildChannels();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) throw new Error("Channel not found.");
  const archiveCategory = channels.find((c) => c.type === CATEGORY_CHANNEL_TYPE && c.name === "📦 Archive");
  if (!archiveCategory) throw new Error('No "📦 Archive" category found on the server.');

  if (channel.parent_id === archiveCategory.id) return { priorCategoryId: null };

  // Read-only: deny SEND_MESSAGES for every role that currently has an
  // overwrite here, without touching VIEW_CHANNEL — still visible, just
  // can't post.
  const newOverwrites: DiscordOverwrite[] = (channel.permission_overwrites || []).map((ow) => {
    const { allow, deny } = mergeOverwriteBit(ow, SEND_MESSAGES_BIT, false);
    return { id: ow.id, type: ow.type, allow: allow.toString(), deny: deny.toString() };
  });
  await patchChannel(channelId, { parent_id: archiveCategory.id, permission_overwrites: newOverwrites });
  return { priorCategoryId: channel.parent_id };
}

export async function restoreChannel(channelId: string, categoryId: string) {
  const channels = await getGuildChannels();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) throw new Error("Channel not found.");
  const targetCategory = channels.find((c) => c.id === categoryId && c.type === CATEGORY_CHANNEL_TYPE);
  if (!targetCategory) throw new Error("Target category not found.");

  // Re-allow SEND_MESSAGES wherever archiving denied it — restores exactly
  // what was taken away, not a guess at what it "should" be.
  const newOverwrites: DiscordOverwrite[] = (channel.permission_overwrites || []).map((ow) => {
    const { allow, deny } = mergeOverwriteBit(ow, SEND_MESSAGES_BIT, true);
    return { id: ow.id, type: ow.type, allow: allow.toString(), deny: deny.toString() };
  });
  await patchChannel(channelId, { parent_id: targetCategory.id, permission_overwrites: newOverwrites });
}

export async function deleteChannelPermanently(channelId: string) {
  await deleteChannel(channelId);
}

// ─── Kick ─────────────────────────────────────────────────────────────────

export async function kickDiscordMember(userId: string, actorLabel: string) {
  await kickMember(userId, `Removed via MetaFashion Pipeline Team Manager by ${actorLabel}`);
}

// ─── Temp access (real table now, not a JSON file — see file header) ──────

export interface TempAccessGrant {
  id: string;
  channelId: string;
  channelName: string;
  granteeType: "user" | "role";
  granteeId: string;
  granteeName: string;
  grantedAt: string;
  expiresAt: string;
  grantedBy: string | null;
}

export async function listTempAccessGrants(): Promise<TempAccessGrant[]> {
  const rows = await db.select().from(discordTempAccess);
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channelId,
    channelName: r.channelName,
    granteeType: r.granteeType as "user" | "role",
    granteeId: r.granteeId,
    granteeName: r.granteeName,
    grantedAt: r.grantedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    grantedBy: r.grantedBy,
  }));
}

export interface GrantTempAccessOptions {
  channelId: string;
  channelName?: string;
  granteeType: "user" | "role";
  granteeId: string;
  granteeName?: string;
  days: number;
  grantedBy: string | null;
}

export async function grantTempAccess(options: GrantTempAccessOptions) {
  const { channelId, channelName, granteeType, granteeId, granteeName, days, grantedBy } = options;
  if (!Number.isFinite(days) || days < 1) throw new Error("days must be a positive integer.");

  const channels = await getGuildChannels();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) throw new Error("Channel not found.");

  const overwriteType = granteeType === "role" ? 0 : 1;
  const existingOv = (channel.permission_overwrites || []).find((o) => o.id === granteeId);
  // Full access, not just view — temp access is meant to let someone
  // genuinely participate for the grant window (post, share images/media),
  // not just silently watch. Matches what onboarding and the permission
  // matrix toggle both grant.
  const { allow, deny } = mergeOverwriteBit(existingOv, FULL_CHANNEL_ACCESS_BITS, true);
  await putChannelPermission(channelId, granteeId, overwriteType as 0 | 1, allow, deny);

  const [row] = await db
    .insert(discordTempAccess)
    .values({
      channelId,
      channelName: channelName || channel.name,
      granteeType,
      granteeId,
      granteeName: granteeName || granteeId,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      grantedBy,
      // Whatever overwrite (if any) existed for this grantee on this
      // channel BEFORE the grant — revoking restores exactly this, rather
      // than deleting the whole overwrite entry outright, which would also
      // destroy any unrelated permission bits already set here for some
      // other reason before the temp grant touched it.
      priorOverwrite: existingOv ? { allow: existingOv.allow, deny: existingOv.deny } : null,
    })
    .returning();

  return row;
}

// Shared by the manual "Revoke Now" action and the scheduled auto-revoke
// cron below — same removal logic either way, only the trigger differs.
export async function revokeTempAccessGrant(grantId: string): Promise<{ ok: boolean; error?: string }> {
  const [grant] = await db.select().from(discordTempAccess).where(eq(discordTempAccess.id, grantId)).limit(1);
  if (!grant) return { ok: false, error: "Grant not found." };

  const overwriteType = grant.granteeType === "role" ? 0 : 1;
  const prior = grant.priorOverwrite as { allow: string; deny: string } | null;
  try {
    if (prior) {
      // Something was already there before the grant (rare, but real) —
      // restore it exactly rather than deleting the entry outright.
      await putChannelPermission(grant.channelId, grant.granteeId, overwriteType as 0 | 1, BigInt(prior.allow), BigInt(prior.deny));
    } else {
      // Nothing existed before — the grant is the only reason this
      // overwrite is here at all, safe to remove entirely.
      await deleteChannelPermission(grant.channelId, grant.granteeId);
    }
  } catch (e) {
    // Already gone (channel deleted, overwrite manually removed, etc.) is
    // fine — the point is the grant record shouldn't say "active" anymore
    // either way. A genuine API failure for another reason still surfaces.
    if ((e as DiscordApiError).status !== 404) throw e;
  }

  await db.delete(discordTempAccess).where(eq(discordTempAccess.id, grantId));
  return { ok: true };
}

export async function expireTempAccessGrants() {
  const now = new Date();
  const expired = await db.select().from(discordTempAccess).where(lte(discordTempAccess.expiresAt, now));
  const results: { grantId: string; channelName: string; granteeName: string; ok: boolean; error?: string }[] = [];
  for (const g of expired) {
    const r = await revokeTempAccessGrant(g.id);
    results.push({ grantId: g.id, channelName: g.channelName, granteeName: g.granteeName, ok: r.ok, error: r.error });
  }
  return { expired: expired.length, results };
}

// Re-exported for callers/tests/routes that only need these directly.
export { discordFetch, isConfigured };
