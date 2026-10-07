import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { assetOffers } from "@/lib/db/schema/asset_offers";
import { assignments } from "@/lib/db/schema/assignments";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { archiveAssets, listHiddenAssets, putAssetBackOnBoard } from "../board-visibility";
import { assignArtistToAsset } from "@/lib/kanban/assignment-service";
import { archiveReasonText } from "../archive-reasons";

const TEAM_EMAIL = "test-archive-team@example.com";
const ARTIST_EMAIL = "test-archive-artist@example.com";
const EMAILS = [TEAM_EMAIL, ARTIST_EMAIL];
const SKU_PREFIX = "TEST-ARCHIVE-";

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${SKU_PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(assetOffers).where(inArray(assetOffers.assetId, ids));
    await db.delete(assignments).where(inArray(assignments.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(emailQueue).where(inArray(emailQueue.toEmail, EMAILS));
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, EMAILS));
  if (people.length > 0) await db.delete(auditLog).where(inArray(auditLog.actorId, people.map((p) => p.id)));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

async function testArchive() {
  console.log("Verifying bulk archive keeps each card's own reason, and putting one back clears it...");
  const [team] = await db.select().from(personnel).where(eq(personnel.email, TEAM_EMAIL));
  await db.insert(assets).values([
    { sku: `${SKU_PREFIX}A`, itemName: "Old trend hat", currentStatus: "unassigned" },
    { sku: `${SKU_PREFIX}B`, itemName: "Duplicate scarf", currentStatus: "unassigned" },
  ]);
  assert.strictEqual(archiveReasonText("Trend has passed", "  "), "Trend has passed");
  const archived = await archiveAssets(
    [
      { sku: `${SKU_PREFIX}A`, reason: archiveReasonText("Trend has passed", "Christmas 2025") },
      { sku: `${SKU_PREFIX}B`, reason: "Duplicate of another asset" },
    ],
    team.id
  );
  assert.deepStrictEqual(archived, [`${SKU_PREFIX}A`, `${SKU_PREFIX}B`]);
  const hidden = (await listHiddenAssets()).filter((h) => h.sku.startsWith(SKU_PREFIX));
  const reasonOf = (sku: string) => hidden.find((h) => h.sku === sku)?.hiddenReason;
  assert.strictEqual(reasonOf(`${SKU_PREFIX}A`), "Trend has passed: Christmas 2025");
  assert.strictEqual(reasonOf(`${SKU_PREFIX}B`), "Duplicate of another asset");
  assert.ok(hidden.every((h) => h.hiddenByName === "Archive Team" && h.hiddenAt instanceof Date), "Who and when are recorded");

  await putAssetBackOnBoard(`${SKU_PREFIX}A`, team.id);
  const [back] = await db.select().from(assets).where(eq(assets.sku, `${SKU_PREFIX}A`));
  assert.strictEqual(back.boardHiddenAt, null);
  assert.strictEqual(back.boardHiddenReason, null, "Putting a card back clears its reason");
  console.log("Confirmed archiving");
}

async function testSelfAssign() {
  console.log("Verifying an offer to a team member is accepted at once, and an artist's waits...");
  const [team] = await db.select().from(personnel).where(eq(personnel.email, TEAM_EMAIL));
  const [artist] = await db.select().from(personnel).where(eq(personnel.email, ARTIST_EMAIL));
  const [mine] = await db.insert(assets).values({ sku: `${SKU_PREFIX}SELF`, itemName: "Self-assigned hat", currentStatus: "unassigned" }).returning();
  const [theirs] = await db.insert(assets).values({ sku: `${SKU_PREFIX}ART`, itemName: "Artist hat", currentStatus: "unassigned" }).returning();

  await assignArtistToAsset({ assetId: mine.id, artistId: team.id, deadline: "2032-03-15", feeAmount: "100.00", actorId: team.id });
  await assignArtistToAsset({ assetId: theirs.id, artistId: artist.id, deadline: "2032-03-15", feeAmount: "100.00", actorId: team.id });
  const [selfOffer] = await db.select().from(assetOffers).where(eq(assetOffers.assetId, mine.id));
  const [artistOffer] = await db.select().from(assetOffers).where(eq(assetOffers.assetId, theirs.id));
  assert.strictEqual(selfOffer.status, "accepted", "A team member's own offer is accepted at once");
  assert.strictEqual(artistOffer.status, "pending", "An artist still answers their offer");
  console.log("Confirmed self-assigning");
}

async function run() {
  await cleanup();
  await db.insert(personnel).values([
    { name: "Archive Team", email: TEAM_EMAIL, roles: ["artist", "operator", "full_time"] },
    { name: "Archive Artist", email: ARTIST_EMAIL, roles: ["artist"] },
  ]);
  await testArchive();
  await testSelfAssign();
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All archive and self-assign assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
