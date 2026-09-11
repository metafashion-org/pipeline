// A short-lived in-process cache for the three Discord reads this app makes over and over: the
// guild's members, channels and roles.
//
// Every one of them is a full-guild fetch, and getGuildMembers pages at 1000 members a request.
// The Team Overview asks for all three on every render, onboarding asks for channels and roles
// again, and each channel-permission toggle asks for both once more. On a guild of any size that
// is several seconds of Discord round trips for data that changes a few times a day.
//
// Two things happen here. Results are held for a TTL, and concurrent callers asking for the same
// key share one in-flight request rather than starting their own — which is the common case, since
// getDiscordOverview asks for all three at once.
//
// Writes invalidate rather than wait for the TTL: the write helpers in discord-service.ts drop the
// keys they affect, so a channel created through this app shows up in the very next read. The TTL
// only bounds how stale a change made in Discord itself can be.

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export const DISCORD_CACHE_KEYS = {
  members: "guild-members",
  channels: "guild-channels",
  roles: "guild-roles",
} as const;

export type DiscordCacheKey = (typeof DISCORD_CACHE_KEYS)[keyof typeof DISCORD_CACHE_KEYS];

// Roles change least often — a role is created when someone is onboarded and almost never
// otherwise — so it carries the longest window. Members and channels move day to day.
export const DISCORD_CACHE_TTL_MS: Record<DiscordCacheKey, number> = {
  [DISCORD_CACHE_KEYS.members]: 60_000,
  [DISCORD_CACHE_KEYS.channels]: 60_000,
  [DISCORD_CACHE_KEYS.roles]: 120_000,
};

// Held on globalThis so a dev-server hot reload does not start over with an empty cache, the same
// reason lib/db/client.ts holds its connection pool there.
const globalForDiscordCache = globalThis as unknown as {
  discordCache?: Map<string, CacheEntry>;
  discordCacheInflight?: Map<string, Promise<unknown>>;
};

const store = (globalForDiscordCache.discordCache ??= new Map<string, CacheEntry>());
const inflight = (globalForDiscordCache.discordCacheInflight ??= new Map<string, Promise<unknown>>());

/**
 * Returns a cached Discord read, fetching it only when there is nothing fresh to return.
 *
 * Input: which of the three guild reads this is, and the function that performs it. Output: the cached value if it has not expired, the result of an already-running fetch for the same key if one is in flight, or a fresh fetch otherwise.
 *
 * A failed fetch is not cached, and it does not leave the key blocked: the next caller retries.
 */
export async function cachedDiscordRead<T>(key: DiscordCacheKey, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = store.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.value as T;
  }

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const promise = loader()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + DISCORD_CACHE_TTL_MS[key] });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * Drops cached Discord reads so the next read goes to Discord.
 *
 * Input: the keys a write has just made wrong. Output: none. Called with no arguments it clears everything, which is what a test or a manual "refresh" wants.
 */
export function invalidateDiscordCache(...keys: DiscordCacheKey[]): void {
  if (keys.length === 0) {
    store.clear();
    return;
  }
  for (const key of keys) store.delete(key);
}

/** What is currently held, for the cache's own test. */
export function discordCacheKeysHeld(): string[] {
  const now = Date.now();
  return [...store.entries()].filter(([, entry]) => entry.expiresAt > now).map(([key]) => key);
}
