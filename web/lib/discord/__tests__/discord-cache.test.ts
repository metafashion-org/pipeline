import assert from "node:assert";
import { cachedDiscordRead, invalidateDiscordCache, discordCacheKeysHeld, DISCORD_CACHE_KEYS } from "../discord-cache";

// The Discord panel reads the whole guild — members, channels, roles — on every render, and the
// member read pages at 1000 members a request. These assertions cover the three properties that
// make caching those reads safe: a write invalidates rather than waits out the TTL, concurrent
// callers share one request instead of each starting their own, and a failed fetch is not
// remembered as if it had succeeded.

async function testRepeatReadsHitTheCache() {
  console.log("Verifying a second read inside the TTL does not call Discord again...");
  invalidateDiscordCache();

  let calls = 0;
  const loader = async () => {
    calls++;
    return [{ id: "chan-1" }];
  };

  const first = await cachedDiscordRead(DISCORD_CACHE_KEYS.channels, loader);
  const second = await cachedDiscordRead(DISCORD_CACHE_KEYS.channels, loader);

  assert.strictEqual(calls, 1, "The second read must come from the cache");
  assert.deepStrictEqual(second, first, "A cached read must return the same value");
  assert.ok(discordCacheKeysHeld().includes(DISCORD_CACHE_KEYS.channels), "The key must be reported as held");

  console.log("✓ Repeat reads inside the TTL are served from the cache");
}

async function testInvalidationForcesARefetch() {
  console.log("Verifying a write's invalidation forces the next read to go to Discord...");
  invalidateDiscordCache();

  let calls = 0;
  const loader = async () => {
    calls++;
    return calls;
  };

  await cachedDiscordRead(DISCORD_CACHE_KEYS.roles, loader);
  // What createRole/createChannel/assignRole do after a successful write.
  invalidateDiscordCache(DISCORD_CACHE_KEYS.roles);
  const afterWrite = await cachedDiscordRead(DISCORD_CACHE_KEYS.roles, loader);

  assert.strictEqual(calls, 2, "Invalidating must force the next read to call Discord");
  assert.strictEqual(afterWrite, 2, "The read after a write must return the new value, not the old one");

  // Invalidating one key must not throw away the others.
  await cachedDiscordRead(DISCORD_CACHE_KEYS.members, async () => ["member"]);
  await cachedDiscordRead(DISCORD_CACHE_KEYS.roles, loader);
  invalidateDiscordCache(DISCORD_CACHE_KEYS.roles);
  assert.ok(discordCacheKeysHeld().includes(DISCORD_CACHE_KEYS.members), "Invalidating roles must leave members cached");
  assert.ok(!discordCacheKeysHeld().includes(DISCORD_CACHE_KEYS.roles), "The invalidated key must no longer be held");

  console.log("✓ A write's invalidation is visible on the very next read");
}

async function testConcurrentReadsShareOneRequest() {
  console.log("Verifying concurrent readers share one in-flight request...");
  invalidateDiscordCache();

  let calls = 0;
  let release: (value: string[]) => void = () => {};
  const gate = new Promise<string[]>((resolve) => {
    release = resolve;
  });
  const loader = () => {
    calls++;
    return gate;
  };

  // getDiscordOverview asks for members, channels and roles at once, and the page and its client
  // refetch can overlap. Without in-flight sharing each of those starts its own full-guild fetch.
  const both = Promise.all([
    cachedDiscordRead(DISCORD_CACHE_KEYS.members, loader),
    cachedDiscordRead(DISCORD_CACHE_KEYS.members, loader),
  ]);
  release(["member-1"]);
  const [a, b] = await both;

  assert.strictEqual(calls, 1, "Two overlapping reads of the same key must produce one request");
  assert.deepStrictEqual(a, ["member-1"]);
  assert.deepStrictEqual(b, ["member-1"]);

  console.log("✓ Overlapping reads of the same key share a single request");
}

async function testFailuresAreNotCached() {
  console.log("Verifying a failed read is not cached and does not block the key...");
  invalidateDiscordCache();

  let calls = 0;
  const loader = async () => {
    calls++;
    if (calls === 1) throw new Error("Discord is down");
    return ["recovered"];
  };

  await assert.rejects(
    () => cachedDiscordRead(DISCORD_CACHE_KEYS.channels, loader),
    /Discord is down/,
    "A failing read must reject rather than resolve"
  );
  assert.ok(!discordCacheKeysHeld().includes(DISCORD_CACHE_KEYS.channels), "A failure must not be stored");

  const recovered = await cachedDiscordRead(DISCORD_CACHE_KEYS.channels, loader);
  assert.deepStrictEqual(recovered, ["recovered"], "The next read after a failure must retry");
  assert.strictEqual(calls, 2, "The retry must actually call Discord again");

  console.log("✓ A failed read is retried rather than remembered");
}

async function main() {
  await testRepeatReadsHitTheCache();
  await testInvalidationForcesARefetch();
  await testConcurrentReadsShareOneRequest();
  await testFailuresAreNotCached();
  invalidateDiscordCache();
  console.log("✓ All Discord cache assertions passed cleanly!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
