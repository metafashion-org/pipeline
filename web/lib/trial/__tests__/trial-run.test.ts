import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { statusHistory } from "@/lib/db/schema/status_history";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { assetOffers } from "@/lib/db/schema/asset_offers";
import { assignments } from "@/lib/db/schema/assignments";
import { assignArtistToAsset } from "@/lib/kanban/assignment-service";
import { updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import { endTrialRun, startTrialRun, trialBotAnswerMove, trialBotAnswerOffer, trialProgress } from "../trial-run";
import { TRIAL_SKU_PREFIX } from "../trial-sku";

const RUNNER_EMAIL = "test-trial-runner@example.com";
// The bot's notices go to a +trial address on whoever started the trial.
const TRIAL_ARTIST_EMAIL = "test-trial-runner+trial@example.com";

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${TRIAL_SKU_PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(statusHistory).where(inArray(statusHistory.assetId, ids));
    await db.delete(assetOffers).where(inArray(assetOffers.assetId, ids));
    await db.delete(assignments).where(inArray(assignments.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(emailQueue).where(inArray(emailQueue.toEmail, [TRIAL_ARTIST_EMAIL]));
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, [TRIAL_ARTIST_EMAIL, RUNNER_EMAIL]));
  if (people.length > 0) await db.delete(auditLog).where(inArray(auditLog.actorId, people.map((p) => p.id)));
  await db.delete(personnel).where(inArray(personnel.email, [TRIAL_ARTIST_EMAIL, RUNNER_EMAIL]));
}

async function testBotPlaysTheArtist() {
  console.log("Verifying the trial bot accepts, sends for review, and resends after revisions...");
  await cleanup();
  const [runner] = await db.insert(personnel).values({ name: "Trial Runner", email: RUNNER_EMAIL, roles: ["operator", "full_time"] }).returning();
  const started = await startTrialRun(runner.id);
  const sku = started.sku;
  assert.ok(sku.startsWith(TRIAL_SKU_PREFIX));
  assert.strictEqual(started.artistEmail, TRIAL_ARTIST_EMAIL, "The bot's email is the runner's +trial address");
  assert.strictEqual((await startTrialRun(runner.id)).sku, sku, "Only one trial at a time");
  const [bot] = await db.select().from(personnel).where(eq(personnel.email, TRIAL_ARTIST_EMAIL));
  assert.strictEqual(bot.status, "Active");

  const [asset] = await db.select().from(assets).where(eq(assets.sku, sku));
  await assignArtistToAsset({ assetId: asset.id, artistId: bot.id, feeAmount: "1.00", deadline: "2032-03-15", actorId: runner.id });
  await updateAssetStatusInKanban(sku, "assigned", { system: true }, "Assigned for the trial");
  const offerMail = await db.select({ subject: emailQueue.subject }).from(emailQueue).where(eq(emailQueue.toEmail, TRIAL_ARTIST_EMAIL));
  assert.ok(offerMail.some((m) => m.subject.startsWith("New offer")), "The bot's offer email goes to the runner's +trial inbox");

  await trialBotAnswerOffer(sku);
  let [now] = await db.select().from(assets).where(eq(assets.sku, sku));
  assert.strictEqual(now.currentStatus, "in_review", "The bot accepted and sent it for review");

  const runnerActor = { roles: ["operator", "full_time"], personnelId: runner.id };
  await updateAssetStatusInKanban(sku, "revisions_requested", runnerActor);
  await trialBotAnswerMove(sku, "revisions_requested");
  [now] = await db.select().from(assets).where(eq(assets.sku, sku));
  assert.strictEqual(now.currentStatus, "in_review", "The bot made the changes and resent it");

  const progress = await trialProgress();
  assert.ok(progress?.reached.includes("revisions_requested"));

  await endTrialRun(runner.id);
  assert.strictEqual(await trialProgress(), null, "Ending hides the test asset");
  const [botAfter] = await db.select().from(personnel).where(eq(personnel.email, TRIAL_ARTIST_EMAIL));
  assert.strictEqual(botAfter.status, "Inactive", "Ending switches the bot off");
  console.log("Confirmed the trial bot");
}

testBotPlaysTheArtist()
  .then(async () => {
    await cleanup();
    console.log("✓ All trial run assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
