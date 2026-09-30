import assert from "node:assert";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { eq, inArray } from "drizzle-orm";
import { notifyArtistOfStatusChange } from "../artist-status";

const SKU = "TEST-STATUS-PING-SKU";
const INACTIVE_SKU = "TEST-STATUS-PING-INACTIVE-SKU";
const ARTIST_EMAIL = "test-status-ping-artist@example.com";
const INACTIVE_EMAIL = "test-status-ping-inactive@example.com";

async function cleanup() {
  // Queued emails go with the asset (email_queue.asset_id cascades).
  await db.delete(assets).where(inArray(assets.sku, [SKU, INACTIVE_SKU]));
  await db.delete(personnel).where(inArray(personnel.email, [ARTIST_EMAIL, INACTIVE_EMAIL]));
}

async function testStatusPings() {
  console.log("Verifying artists are emailed when their card moves to Approved or Revisions Requested...");
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

  // Approved: hand in the final files, with the asset picked on Submit final files.
  await notifyArtistOfStatusChange(SKU, "approved");
  const [approval] = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, ARTIST_EMAIL));
  assert.ok(approval?.subject.startsWith("Approved: Ping Test Hat"), `Unexpected subject: ${approval?.subject}`);
  assert.ok(approval.bodyHtml.includes(`/artist/submit?sku=${SKU}`), "The button opens Submit final files with the asset picked");
  console.log("Confirmed the approval email links to Submit final files with the asset picked");

  // Revisions Requested: what to do once the changes are made, and a link to the card.
  await notifyArtistOfStatusChange(SKU, "revisions_requested");
  const emails = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, ARTIST_EMAIL));
  const revisions = emails.find((e) => e.subject.startsWith("Changes requested: Ping Test Hat"));
  assert.ok(revisions, "The artist is emailed when changes are requested");
  assert.ok(revisions.bodyHtml.includes("then to In Review when they"), "The email says what to do once the changes are made");
  assert.ok(revisions.bodyHtml.includes(`/artist?asset=${SKU}`), "The button opens the card on My Tasks");
  console.log("Confirmed the revisions email says what to do next and links to the card");

  // No one to tell: an artist who is no longer Active, or an asset with no artist.
  await notifyArtistOfStatusChange(INACTIVE_SKU, "approved");
  await notifyArtistOfStatusChange("TEST-STATUS-PING-NO-SUCH-SKU", "revisions_requested");
  const toInactive = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, INACTIVE_EMAIL));
  assert.strictEqual(toInactive.length, 0, "An inactive artist isn't emailed");
  console.log("Confirmed nothing is sent to an inactive artist or for an unknown SKU");
}

testStatusPings()
  .then(async () => {
    await cleanup();
    console.log("✓ All status ping assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
