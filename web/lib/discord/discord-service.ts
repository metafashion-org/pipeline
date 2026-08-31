// lib/discord/discord-service.ts
// Discord REST API v10 wrapper — ported from Catalog Intel's
// server/lib/discord.cjs (same logic, same env var names, same bot token),
// not reimplemented from scratch. That file is the origin of every comment
// and constant below; see it for the real incidents referenced inline
// (the FULL_CHANNEL_ACCESS_BITS one especially — a real, previously-shipped
// bug, not a hypothetical).
//
// Soft-fail: if DISCORD_BOT_TOKEN isn't set, isConfigured() is false and
// callers should return a clear "not configured" response rather than
// throwing.

const API_BASE = "https://discord.com/api/v10";

// Minimal shapes for the real Discord REST v10 fields this app actually
// reads/writes — not a full API type library, just enough to get rid of
// `any` at the boundary between raw JSON and the rest of the app.
export interface DiscordOverwrite {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  bot?: boolean;
}

export interface DiscordGuildMember {
  user: DiscordUser;
  nick: string | null;
  roles: string[];
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  mentionable: boolean;
  hoist: boolean;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  permission_overwrites: DiscordOverwrite[];
  topic?: string;
}

let warnedMissingConfig = false;

export function isConfigured(): boolean {
  const ok = !!process.env.DISCORD_BOT_TOKEN && !!process.env.DISCORD_GUILD_ID;
  if (!ok && !warnedMissingConfig) {
    console.warn("[discord] DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not set — Discord features disabled.");
    warnedMissingConfig = true;
  }
  return ok;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Discord's own rate-limit convention differs from Google's: a 429 response
// carries a `Retry-After` header (seconds) telling you exactly how long to
// wait — honor that directly instead of guessing with exponential backoff.
// 5xx still gets a short exponential backoff. Bounded at 4 attempts either way.
const MAX_FETCH_ATTEMPTS = 4;

export interface DiscordApiError extends Error {
  status?: number;
}

export async function discordFetch<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = process.env.DISCORD_BOT_TOKEN;
  let lastErr: DiscordApiError | undefined;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    const r = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (r.status === 204) return null as T; // no-content success
    const data = await r.json().catch(() => ({}));
    if (r.ok) return data as T;

    const err: DiscordApiError = new Error(data.message || `${r.status} ${r.statusText}`);
    err.status = r.status;
    lastErr = err;
    if (attempt === MAX_FETCH_ATTEMPTS) throw err;

    if (r.status === 429) {
      const retryAfterSec = Number(r.headers.get("retry-after")) || data.retry_after || 1;
      console.error(`[discord] 429 rate-limited on attempt ${attempt}/${MAX_FETCH_ATTEMPTS} — retrying in ${retryAfterSec}s`);
      await sleep(retryAfterSec * 1000 + 100);
    } else if (r.status >= 500) {
      const backoffMs = Math.min(8000, 1000 * 2 ** (attempt - 1));
      console.error(`[discord] ${r.status} on attempt ${attempt}/${MAX_FETCH_ATTEMPTS} (${err.message}) — retrying in ${backoffMs}ms`);
      await sleep(backoffMs);
    } else {
      // Not retryable (4xx other than 429) — fail immediately.
      throw err;
    }
  }
  throw lastErr;
}

export async function getGuildMembers(): Promise<DiscordGuildMember[]> {
  // Discord paginates at 1000/page via `after` (last-seen user id).
  const guildId = process.env.DISCORD_GUILD_ID;
  const all: DiscordGuildMember[] = [];
  let after = "0";
  for (;;) {
    const page = await discordFetch<DiscordGuildMember[]>(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return all;
}

export async function getGuildChannels(): Promise<DiscordChannel[]> {
  return discordFetch<DiscordChannel[]>(`/guilds/${process.env.DISCORD_GUILD_ID}/channels`);
}

export async function getGuildRoles(): Promise<DiscordRole[]> {
  return discordFetch<DiscordRole[]>(`/guilds/${process.env.DISCORD_GUILD_ID}/roles`);
}

// Discord channel type 4 = category. Every non-category channel carries
// parent_id pointing at its category's channel id.
export const CATEGORY_CHANNEL_TYPE = 4;

export type RoleBucket = "admin" | "manager" | "curator" | "artist" | null;

// Classifies a role's name into one of the spec's four display buckets.
export function classifyRoleName(name: string): RoleBucket {
  if (name === "Admin") return "admin";
  if (name === "Manager") return "manager";
  if (name === "Concept Curation Manager" || name === "Animation Team") return "curator";
  if (/^Artist:/i.test(name)) return "artist";
  return null;
}

// Lifted verbatim from Catalog Intel's own discord.cjs, which itself was
// lifted near-verbatim from the spec's own "Department Rules" block.
export const DEPARTMENT_RULES: Record<
  string,
  { emoji: string; categoryName: string; managerSees: boolean; sharedChannelName: string | null; sharedRoleName?: string }
> = {
  "3D UGC Accessories": {
    emoji: "🎨",
    categoryName: "🎨 3D UGC Accessories",
    managerSees: true,
    sharedChannelName: null,
  },
  Animations: {
    emoji: "🎬",
    categoryName: "🎬 Animations",
    managerSees: false,
    sharedChannelName: "🎬│animation-concepts",
    sharedRoleName: "Animation Team",
  },
  "Hair Team": {
    emoji: "✂️",
    categoryName: "Hair Team",
    managerSees: true,
    sharedChannelName: "✂️│hair-pipeline",
  },
  "Curation Dept": {
    emoji: "💡",
    categoryName: "Curation Dept",
    managerSees: true,
    sharedChannelName: "ready-to-go-concepts",
  },
};

export const NEW_CHANNEL_MESSAGE_TEMPLATE = (displayName: string, department: string) =>
  `Hey ${displayName}! 👋 This is your channel — ${department} work and coordination happens here. Welcome to the team! 🎉`;

// ─── Write helpers ────────────────────────────────────────────────────────

export async function createRole(name: string, color?: number): Promise<DiscordRole> {
  return discordFetch<DiscordRole>(`/guilds/${process.env.DISCORD_GUILD_ID}/roles`, {
    method: "POST",
    body: JSON.stringify({ name, color: color ?? 0x3498db, mentionable: false, hoist: false }),
  });
}

export async function assignRole(userId: string, roleId: string): Promise<void> {
  await discordFetch(`/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`, { method: "PUT" });
}

export async function createChannel(
  name: string,
  parentId: string | null,
  permissionOverwrites: DiscordOverwrite[],
  topic?: string
): Promise<DiscordChannel> {
  return discordFetch<DiscordChannel>(`/guilds/${process.env.DISCORD_GUILD_ID}/channels`, {
    method: "POST",
    body: JSON.stringify({ name, type: 0, parent_id: parentId, permission_overwrites: permissionOverwrites, topic }),
  });
}

export async function patchChannel(channelId: string, patch: Record<string, unknown>): Promise<DiscordChannel> {
  return discordFetch<DiscordChannel>(`/channels/${channelId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function deleteChannel(channelId: string): Promise<void> {
  await discordFetch(`/channels/${channelId}`, { method: "DELETE" });
}

// Sets ONE overwrite entry (role or member) on a channel. Discord's PUT here
// REPLACES the whole entry — callers that want to change just one bit must
// merge against the channel's current overwrite first, see mergeOverwriteBit.
export async function putChannelPermission(
  channelId: string,
  overwriteId: string,
  type: 0 | 1,
  allow: bigint,
  deny: bigint
): Promise<void> {
  await discordFetch(`/channels/${channelId}/permissions/${overwriteId}`, {
    method: "PUT",
    body: JSON.stringify({ id: overwriteId, type, allow: allow.toString(), deny: deny.toString() }),
  });
}

export async function deleteChannelPermission(channelId: string, overwriteId: string): Promise<void> {
  await discordFetch(`/channels/${channelId}/permissions/${overwriteId}`, { method: "DELETE" });
}

// BigInt(...) calls rather than `1024n` literal syntax: this project's
// tsconfig targets ES2017, which doesn't support BigInt literals, and that's
// a shared, project-wide setting not worth changing just for this file.
export const VIEW_CHANNEL_BIT = BigInt(1024);
export const SEND_MESSAGES_BIT = BigInt(2048);
export const READ_MESSAGE_HISTORY_BIT = BigInt(65536);
export const ATTACH_FILES_BIT = BigInt(32768);
export const EMBED_LINKS_BIT = BigInt(16384);
// What "full access" to an artist channel actually needs — a real incident
// in Catalog Intel's own version of this code: the first FULL_ACCESS
// omitted ATTACH_FILES/EMBED_LINKS, so every role on a channel created that
// way could view and send text but not attach images/media at all. Caught
// from a real report ("Jayesh can't send images in Rishiraj's chat") —
// turned out to affect every role on that channel, not just Jayesh's.
// Centralizing this here so it can't happen twice.
export const FULL_CHANNEL_ACCESS_BITS =
  VIEW_CHANNEL_BIT | SEND_MESSAGES_BIT | READ_MESSAGE_HISTORY_BIT | ATTACH_FILES_BIT | EMBED_LINKS_BIT;

// Merges a single permission bit's allow/deny into whatever overwrite
// (possibly none) already exists for this id, preserving every other bit.
export function mergeOverwriteBit(
  existingOverwrite: DiscordOverwrite | undefined,
  bit: bigint,
  allowed: boolean
): { allow: bigint; deny: bigint } {
  let allow = existingOverwrite ? BigInt(existingOverwrite.allow) : BigInt(0);
  let deny = existingOverwrite ? BigInt(existingOverwrite.deny) : BigInt(0);
  if (allowed) {
    allow |= bit;
    deny &= ~bit;
  } else {
    deny |= bit;
    allow &= ~bit;
  }
  return { allow, deny };
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
}

export async function sendMessage(channelId: string, content: string): Promise<DiscordMessage> {
  return discordFetch<DiscordMessage>(`/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
}

export async function pinMessage(channelId: string, messageId: string): Promise<void> {
  await discordFetch(`/channels/${channelId}/pins/${messageId}`, { method: "PUT" });
}

export async function kickMember(userId: string, reason?: string): Promise<void> {
  await discordFetch(`/guilds/${process.env.DISCORD_GUILD_ID}/members/${userId}`, {
    method: "DELETE",
    headers: reason ? { "X-Audit-Log-Reason": reason.slice(0, 500) } : {},
  });
}

export async function searchMembers(query: string): Promise<DiscordGuildMember[]> {
  return discordFetch<DiscordGuildMember[]>(`/guilds/${process.env.DISCORD_GUILD_ID}/members/search?query=${encodeURIComponent(query)}&limit=10`);
}
