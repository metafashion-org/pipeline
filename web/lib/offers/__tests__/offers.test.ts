import assert from "node:assert";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { assignments } from "@/lib/db/schema/assignments";
import { assetOffers } from "@/lib/db/schema/asset_offers";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { and, eq, inArray } from "drizzle-orm";
import { assignArtistToAsset } from "@/lib/kanban/assignment-service";
import { updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import {
  acceptOffer,
  approveDeadlineExtension,
  declineOffer,
  OfferActionError,
  rejectDeadlineExtension,
  requestDeadlineExtension,
} from "../offer-service";

const TEST_SKU = "TEST-OFFERS-SKU";
const ARTIST_EMAIL = "test-offers-artist@example.com";
const OTHER_EMAIL = "test-offers-other@example.com";
const OFFERED = "2026-10-10";

async function cleanup() {
  await db.delete(assets).where(eq(assets.sku, TEST_SKU));
  await db.delete(personnel).where(inArray(personnel.email, [ARTIST_EMAIL, OTHER_EMAIL]));
}

// A fresh asset, offered to a fresh artist at OFFERED, the way the Assign dialog does it.
async function setUp() {
  await cleanup();
  const [artist] = await db.insert(personnel).values({ name: "Offer Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  const [other] = await db.insert(personnel).values({ name: "Other Artist", email: OTHER_EMAIL, roles: ["artist"] }).returning();
  const [asset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU, itemName: "Offer Test Asset", currentStatus: "unassigned", feeAmount: "3500.00", currency: "INR" })
    .returning();
  const { offerId, assignmentId } = await assignArtistToAsset({ assetId: asset.id, artistId: artist.id, deadline: OFFERED });
  await updateAssetStatusInKanban(TEST_SKU, "assigned", { system: true });
  return { artist, other, asset, offerId, assignmentId };
}

function dayOf(date: Date | null) {
  return date ? new Date(date).toISOString().slice(0, 10) : null;
}

async function expectRefusal(action: () => Promise<unknown>, httpStatus: number, what: string) {
  await assert.rejects(action, (err: unknown) => err instanceof OfferActionError && err.httpStatus === httpStatus, what);
}

async function testAccept() {
  console.log("Verifying accept agrees the offered deadline and queues the full brief...");
  const { artist, other, asset, offerId } = await setUp();

  await expectRefusal(() => acceptOffer(offerId, other.id), 403, "Another artist must not accept someone else's offer");

  const accepted = await acceptOffer(offerId, artist.id);
  assert.strictEqual(accepted.status, "accepted");
  assert.strictEqual(dayOf(accepted.agreedDeadline), OFFERED);

  const briefs = await db
    .select()
    .from(emailQueue)
    .where(and(eq(emailQueue.assetId, asset.id), eq(emailQueue.toEmail, ARTIST_EMAIL)));
  assert.ok(briefs.some((e) => e.subject.startsWith("Meta Fashion Assignment")), "Accepting must queue the full brief");

  await expectRefusal(() => acceptOffer(offerId, artist.id), 409, "An accepted offer can't be accepted again");
}

async function testExtensionRangeAndApproval() {
  console.log("Verifying a deadline request is limited to 1-3 days and only counts once approved...");
  const { artist, asset, offerId } = await setUp();

  await expectRefusal(() => requestDeadlineExtension(offerId, artist.id, new Date("2026-10-14"), null), 400, "4 days is past the limit");
  await expectRefusal(() => requestDeadlineExtension(offerId, artist.id, new Date("2026-10-10"), null), 400, "The same day isn't a later deadline");

  const requested = await requestDeadlineExtension(offerId, artist.id, new Date("2026-10-12"), "Two other deliveries that week");
  assert.strictEqual(requested.status, "extension_requested");

  const [unchanged] = await db.select().from(assets).where(eq(assets.id, asset.id)).limit(1);
  assert.strictEqual(dayOf(unchanged.deadline), OFFERED, "Nothing changes on the asset until the team approves");

  const approved = await approveDeadlineExtension(offerId, undefined);
  assert.strictEqual(approved.status, "accepted");
  assert.strictEqual(dayOf(approved.agreedDeadline), "2026-10-12");

  const [updated] = await db.select().from(assets).where(eq(assets.id, asset.id)).limit(1);
  assert.strictEqual(dayOf(updated.deadline), "2026-10-12", "The approved date becomes the asset's deadline");
}

async function testExtensionRejected() {
  console.log("Verifying a rejected request leaves the original offer open...");
  const { artist, offerId } = await setUp();

  await requestDeadlineExtension(offerId, artist.id, new Date("2026-10-11"), null);
  const rejected = await rejectDeadlineExtension(offerId, undefined);
  assert.strictEqual(rejected.status, "pending", "The artist can still accept at the original date, or decline");
  assert.strictEqual(rejected.extensionDecision, "rejected");

  const accepted = await acceptOffer(offerId, artist.id);
  assert.strictEqual(dayOf(accepted.agreedDeadline), OFFERED);
}

async function testDecline() {
  console.log("Verifying decline returns the asset to Unassigned and ends the assignment...");
  const { artist, asset, offerId, assignmentId } = await setUp();

  const declined = await declineOffer(offerId, artist.id, "Fee is too low for the detail needed");
  assert.strictEqual(declined.status, "declined");
  assert.strictEqual(declined.declineReason, "Fee is too low for the detail needed");

  const [after] = await db.select().from(assets).where(eq(assets.id, asset.id)).limit(1);
  assert.strictEqual(after.currentStatus, "unassigned");
  assert.strictEqual(after.currentArtistId, null);

  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
  assert.strictEqual(assignment.isActive, false);

  const [offer] = await db.select().from(assetOffers).where(eq(assetOffers.id, offerId)).limit(1);
  assert.strictEqual(offer.status, "declined");
}

async function main() {
  try {
    await testAccept();
    await testExtensionRangeAndApproval();
    await testExtensionRejected();
    await testDecline();
    console.log("✓ All offer assertions passed cleanly!");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
