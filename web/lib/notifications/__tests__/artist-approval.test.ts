import assert from "node:assert";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { eq, inArray } from "drizzle-orm";
import { notifyArtistAssetApproved } from "../artist-approval";

const SKU = "TEST-APPROVAL-PING-SKU";
const INACTIVE_SKU = "TEST-APPROVAL-PING-INACTIVE-SKU";
const ARTIST_EMAIL = "test-approval-ping-artist@example.com";
const INACTIVE_EMAIL = "test-approval-ping-inactive@example.com";

async function cleanup() {
  // Queued emails go with the asset (email_queue.asset_id cascades).
  await db.delete(assets).where(inArray(assets.sku, [SKU, INACTIVE_SKU]));
  await db.delete(personnel).where(inArray(personnel.email, [ARTIST_EMAIL, INACTIVE_EMAIL]));
}

async function testApprovalPing() {
  console.log("Verifying an approved asset's artist is emailed a link to hand in the final files...");
  await cleanup();
  const [artist] = await db.insert(personnel).values({ name: "Ping Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  const [inactive] = await db
    .insert(personnel)
    .values({ name: "Gone Artist", email: INACTIVE_EMAIL, roles: ["artist"], status: "Inactive" })
    .returning();
  await db.insert(assets).values([
    { sku: SKU, itemName: "Ping Test Hat", currentStatus: "approved", currentArtistId: artist.id, deadline: new Date("2026-10-10") },
    { sku: INACTIVE_SKU, itemName: "Ping Test Scarf", currentStatus: "approved", currentArtistId: inactive.id },
  ]);

  await notifyArtistAssetApproved(SKU);
  const queued = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, ARTIST_EMAIL));
  assert.strictEqual(queued.length, 1, "The artist gets one email");
  assert.ok(queued[0].subject.startsWith("Approved: Ping Test Hat"), `Unexpected subject: ${queued[0].subject}`);
  assert.ok(queued[0].bodyHtml.includes(`/artist/submit?sku=${SKU}`), "The button opens Submit final files with the asset picked");
  console.log("Confirmed the artist's email links to Submit final files with the asset picked");

  // No one to tell: an artist who is no longer Active, or an asset with no artist.
  await notifyArtistAssetApproved(INACTIVE_SKU);
  await notifyArtistAssetApproved("TEST-APPROVAL-PING-NO-SUCH-SKU");
  const toInactive = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, INACTIVE_EMAIL));
  assert.strictEqual(toInactive.length, 0, "An inactive artist isn't emailed");
  console.log("Confirmed nothing is sent to an inactive artist or for an unknown SKU");
}

testApprovalPing()
  .then(async () => {
    await cleanup();
    console.log("✓ All approval ping assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
