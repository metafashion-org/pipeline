import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { assetComments } from "@/lib/db/schema/asset_comments";
import { auditLog } from "@/lib/db/schema/audit_log";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { personnel } from "@/lib/db/schema/personnel";
import { teamNotifications } from "@/lib/db/schema/team_notifications";
import { listTeamNotifications } from "@/lib/team-tasks/team-notifications";
import { addAssetComment, AssetCommentError, listAssetComments, listMentionablePeople } from "../asset-comments-service";

const SKU_PREFIX = "TEST-COMMENTS-";
const SKU = `${SKU_PREFIX}HAT`;
const AUTHOR_EMAIL = "test-comments-author@example.com";
const TEAM_EMAIL = "test-comments-team@example.com";
const ARTIST_EMAIL = "test-comments-artist@example.com";
const OTHER_ARTIST_EMAIL = "test-comments-other-artist@example.com";
const INACTIVE_EMAIL = "test-comments-inactive@example.com";
const EMAILS = [AUTHOR_EMAIL, TEAM_EMAIL, ARTIST_EMAIL, OTHER_ARTIST_EMAIL, INACTIVE_EMAIL];

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${SKU_PREFIX}%`));
  const assetIds = rows.map((r) => r.id);
  if (assetIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, assetIds));
    await db.delete(assets).where(inArray(assets.id, assetIds));
  }
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, EMAILS));
  if (people.length > 0) await db.delete(auditLog).where(inArray(auditLog.actorId, people.map((p) => p.id)));
  await db.delete(emailQueue).where(inArray(emailQueue.toEmail, EMAILS));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

async function run() {
  await cleanup();
  const [author] = await db.insert(personnel).values({ name: "Comment Author", email: AUTHOR_EMAIL, roles: ["admin", "full_time"] }).returning();
  const [team] = await db.insert(personnel).values({ name: "Comment Teammate", email: TEAM_EMAIL, roles: ["Full_Time", "operator"] }).returning();
  // Named to sort before the card's own artist, so the test shows the card's artist is moved first.
  const [otherArtist] = await db.insert(personnel).values({ name: "AAA Other Artist", email: OTHER_ARTIST_EMAIL, roles: ["Artist"] }).returning();
  const [artist] = await db.insert(personnel).values({ name: "Comment Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  const [inactive] = await db.insert(personnel).values({ name: "Gone Artist", email: INACTIVE_EMAIL, roles: ["artist"], status: "Inactive" }).returning();
  const [asset] = await db.insert(assets).values({ sku: SKU, itemName: "Comment hat", currentStatus: "payment_done", currentArtistId: artist.id }).returning();

  console.log("Verifying who can be mentioned on an asset...");
  const people = await listMentionablePeople(SKU);
  const ids = people.map((p) => p.id);
  assert.ok(ids.includes(team.id) && !people.find((p) => p.id === team.id)?.freelancer, "The full-time team can be mentioned");
  const freelancers = people.filter((p) => p.freelancer);
  assert.strictEqual(freelancers[0]?.id, artist.id, "The card's own artist is the first freelancer listed");
  assert.ok(ids.includes(otherArtist.id), "Other Active freelancers can be mentioned");
  assert.ok(!ids.includes(inactive.id), "Inactive people can't");
  assert.ok(people.findIndex((p) => p.freelancer) > people.findIndex((p) => p.id === team.id), "The team is listed before freelancers");

  console.log("Verifying a comment is saved and tells the team member and the freelancer...");
  await addAssetComment(SKU, "@Comment Teammate @Comment Artist the strap clips through", [team.id, artist.id, inactive.id, author.id], author.id);
  const [comment] = await listAssetComments(SKU);
  assert.strictEqual(comment.authorName, "Comment Author");
  assert.deepStrictEqual([...comment.mentionedIds].sort(), [team.id, artist.id, author.id].sort(), "An inactive person's mention is dropped");

  const teamBell = await db.select().from(teamNotifications).where(eq(teamNotifications.recipientId, team.id));
  assert.strictEqual(teamBell.length, 1, "The team member gets one bell notice");
  assert.strictEqual(teamBell[0].assetId, asset.id, "The notice points at the asset");
  const { notifications } = await listTeamNotifications(team.id);
  assert.strictEqual(notifications[0].assetSku, SKU, "The bell gets the SKU to open the card");
  assert.strictEqual((await db.select().from(teamNotifications).where(eq(teamNotifications.recipientId, artist.id))).length, 0, "Freelancers get no bell notice");
  assert.strictEqual((await db.select().from(teamNotifications).where(eq(teamNotifications.recipientId, author.id))).length, 0, "Nobody is told about their own comment");

  const [teamEmail] = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, TEAM_EMAIL));
  assert.ok(teamEmail?.bodyHtml.includes(`/admin/board?asset=${SKU}`), "The team email opens the card on the Board");
  const [artistEmail] = await db.select().from(emailQueue).where(eq(emailQueue.toEmail, ARTIST_EMAIL));
  assert.ok(artistEmail?.bodyHtml.includes("/artist") && !artistEmail.bodyHtml.includes("/admin/board"), "The freelancer email opens their own page, not the Board");
  assert.ok(artistEmail.bodyHtml.includes("the strap clips through"), "The email quotes the comment");

  await assert.rejects(addAssetComment(`${SKU_PREFIX}NOPE`, "hi", [], author.id), AssetCommentError, "An unknown SKU is refused");

  await db.delete(assets).where(eq(assets.id, asset.id));
  assert.strictEqual((await db.select().from(assetComments).where(eq(assetComments.assetId, asset.id))).length, 0, "Comments go with their asset");
  console.log("Confirmed asset comments");
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All asset comment assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
