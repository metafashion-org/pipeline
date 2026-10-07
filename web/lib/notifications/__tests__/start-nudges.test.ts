import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { assets } from "@/lib/db/schema/assets";
import { assetOffers } from "@/lib/db/schema/asset_offers";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { appSettings } from "@/lib/db/schema/app_settings";
import { sendArtistStartNudges, START_NUDGE_SUBJECT } from "../start-nudges";

const ARTIST_EMAIL = "test-nudge-artist@example.com";
const OTHER_EMAIL = "test-nudge-other@example.com";
const EMAILS = [ARTIST_EMAIL, OTHER_EMAIL];
const SKU_PREFIX = "TEST-NUDGE-";
const LAST_RUN_KEY = "artist_start_nudges_last_at";
const HOUR_MS = 60 * 60 * 1000;

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${SKU_PREFIX}%`));
  if (rows.length > 0) {
    await db.delete(assetOffers).where(inArray(assetOffers.assetId, rows.map((r) => r.id)));
    await db.delete(assets).where(inArray(assets.id, rows.map((r) => r.id)));
  }
  await db.delete(emailQueue).where(inArray(emailQueue.toEmail, EMAILS));
  await db.delete(appSettings).where(eq(appSettings.key, LAST_RUN_KEY));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

// An asset in the given status with one offer to the artist, sent `hoursAgo` hours before `now`.
async function assetWithOffer(
  suffix: string,
  artistId: string,
  now: Date,
  hoursAgo: number,
  offer: { status: "pending" | "accepted" | "extension_requested"; respondedHoursAgo?: number },
  options: { status?: string; hidden?: boolean } = {}
) {
  const [asset] = await db
    .insert(assets)
    .values({
      sku: `${SKU_PREFIX}${suffix}`,
      itemName: `Nudge ${suffix}`,
      currentStatus: options.status ?? "assigned",
      boardHiddenAt: options.hidden ? now : null,
    })
    .returning();
  await db.insert(assetOffers).values({
    assetId: asset.id,
    artistId,
    status: offer.status,
    offeredDeadline: new Date(now.getTime() + 7 * 24 * HOUR_MS),
    createdAt: new Date(now.getTime() - hoursAgo * HOUR_MS),
    respondedAt: offer.respondedHoursAgo === undefined ? null : new Date(now.getTime() - offer.respondedHoursAgo * HOUR_MS),
  });
}

async function testNudges() {
  console.log("Verifying each artist gets one check-in listing only the assets waiting 12 hours or more...");
  await cleanup();
  const [artist] = await db.insert(personnel).values({ name: "Nudge Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  const [other] = await db.insert(personnel).values({ name: "Other Artist", email: OTHER_EMAIL, roles: ["artist"] }).returning();
  const now = new Date();

  await assetWithOffer("UNANSWERED", artist.id, now, 13, { status: "pending" });
  await assetWithOffer("ACCEPTED", artist.id, now, 40, { status: "accepted", respondedHoursAgo: 20 });
  // Accepted 2 hours ago: the 12 hours count from the acceptance, not the offer.
  await assetWithOffer("JUSTACCEPTED", artist.id, now, 30, { status: "accepted", respondedHoursAgo: 2 });
  await assetWithOffer("FRESH", artist.id, now, 3, { status: "pending" });
  await assetWithOffer("EXTENSION", artist.id, now, 30, { status: "extension_requested", respondedHoursAgo: 25 });
  await assetWithOffer("STARTED", artist.id, now, 30, { status: "accepted", respondedHoursAgo: 25 }, { status: "in_progress" });
  await assetWithOffer("ARCHIVED", artist.id, now, 30, { status: "accepted", respondedHoursAgo: 25 }, { hidden: true });
  await assetWithOffer("OTHERFRESH", other.id, now, 1, { status: "pending" });

  const emailed = await sendArtistStartNudges(now);
  assert.ok(emailed >= 1, "At least the test artist is emailed");

  const mine = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, ARTIST_EMAIL));
  assert.strictEqual(mine.length, 1, "One email for all of an artist's assets");
  assert.strictEqual(mine[0].subject, START_NUDGE_SUBJECT);
  const body = mine[0].bodyHtml;
  assert.ok(body.includes(`${SKU_PREFIX}UNANSWERED`) && body.includes("answer the offer"), "An unanswered offer is listed");
  assert.ok(body.includes(`${SKU_PREFIX}ACCEPTED`) && body.includes("move to In Production"), "Accepted, not started work is listed");
  for (const skipped of ["JUSTACCEPTED", "FRESH", "EXTENSION", "STARTED", "ARCHIVED"]) {
    assert.ok(!body.includes(`Nudge ${skipped}:`), `${skipped} isn't listed`);
  }
  assert.ok(body.includes("Hi Nudge"), "Greets the artist by first name");

  const others = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, OTHER_EMAIL));
  assert.strictEqual(others.length, 0, "An artist with nothing waiting 12 hours isn't emailed");

  assert.strictEqual(await sendArtistStartNudges(new Date(now.getTime() + 2 * HOUR_MS)), 0, "A second call soon after sends nothing");
  const later = new Date(now.getTime() + 12 * HOUR_MS);
  assert.ok((await sendArtistStartNudges(later)) >= 1, "The next scheduled run 12 hours later sends again");
  const afterTwoRuns = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, OTHER_EMAIL));
  assert.strictEqual(afterTwoRuns.length, 1, "The other artist's offer is in the check-in once it has waited 12 hours");
  console.log("Confirmed artist check-ins");
}

testNudges()
  .then(async () => {
    await cleanup();
    console.log("✓ All artist check-in assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
