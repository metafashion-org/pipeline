import assert from "node:assert";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { assets } from "@/lib/db/schema/assets";
import { assetSignoffs } from "@/lib/db/schema/asset_signoffs";
import { auditLog } from "@/lib/db/schema/audit_log";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { appSettings } from "@/lib/db/schema/app_settings";
import { statusHistory } from "@/lib/db/schema/status_history";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { approveSignoffs, dropSignoff, listSignoffs, recordSignoffRequest, resubmitSignoff, sendBackSignoff, sendSignoffDigest, SignoffError, type SignoffActor } from "../signoff-service";
import { inDigestHours, signsOff, SIGNOFF_DIGEST_TO, SIGNOFF_STATUS } from "../signoff-rules";

const ADMIN_EMAIL = "test-signoff-admin@example.com";
const ADDER_EMAIL = "test-signoff-adder@example.com";
const OTHER_EMAIL = "test-signoff-other@example.com";
const EMAILS = [ADMIN_EMAIL, ADDER_EMAIL, OTHER_EMAIL];
const SKU_PREFIX = "TEST-SIGNOFF-";
const DIGEST_KEY = "signoff_digest_last_at";

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${SKU_PREFIX}%`));
  const assetIds = rows.map((r) => r.id);
  if (assetIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, assetIds));
    await db.delete(statusHistory).where(inArray(statusHistory.assetId, assetIds));
    await db.delete(assets).where(inArray(assets.id, assetIds));
  }
  await db.delete(emailQueue).where(or(inArray(emailQueue.toEmail, EMAILS), and(eq(emailQueue.toEmail, SIGNOFF_DIGEST_TO), like(emailQueue.subject, "%waiting for your sign-off%"))));
  await db.delete(appSettings).where(eq(appSettings.key, DIGEST_KEY));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

function actor(person: { id: string; roles: string[] }): SignoffActor {
  return { personnelId: person.id, roles: person.roles, caps: getEffectiveCapabilities(person.roles, {}) };
}

// What POST /api/assets does for someone who doesn't sign off.
async function addForSignoff(sku: string, adderId: string) {
  const [asset] = await db.insert(assets).values({ sku, itemName: `Sign-off test ${sku}`, currentStatus: SIGNOFF_STATUS }).returning();
  await recordSignoffRequest(asset.id, adderId);
  return asset;
}

function testRules() {
  console.log("Verifying who signs off and the digest hours...");
  assert.strictEqual(signsOff(["admin", "full_time"]), true);
  assert.strictEqual(signsOff(["operator", "publisher"]), false);
  assert.strictEqual(inDigestHours(new Date("2032-03-15T04:30:00Z")), true, "10:00 IST");
  assert.strictEqual(inDigestHours(new Date("2032-03-15T14:30:00Z")), true, "20:00 IST");
  assert.strictEqual(inDigestHours(new Date("2032-03-15T16:30:00Z")), false, "22:00 IST");
  assert.strictEqual(inDigestHours(new Date("2032-03-15T02:00:00Z")), false, "07:30 IST");
  console.log("Confirmed the rules");
}

async function testFlow() {
  console.log("Verifying send back, resubmit, digest, approve and drop...");
  await cleanup();
  const [admin] = await db.insert(personnel).values({ name: "Signoff Admin", email: ADMIN_EMAIL, roles: ["admin", "full_time"] }).returning();
  const [adder] = await db.insert(personnel).values({ name: "Signoff Adder", email: ADDER_EMAIL, roles: ["operator", "full_time"] }).returning();
  const [other] = await db.insert(personnel).values({ name: "Signoff Other", email: OTHER_EMAIL, roles: ["operator"] }).returning();
  const hat = await addForSignoff(`${SKU_PREFIX}HAT`, adder.id);
  const bag = await addForSignoff(`${SKU_PREFIX}BAG`, adder.id);

  const listed = (await listSignoffs()).filter((i) => i.card.sku.startsWith(SKU_PREFIX));
  assert.strictEqual(listed.length, 2);
  assert.ok(listed.every((i) => i.state === "waiting" && i.submittedByName === "Signoff Adder"));

  await assert.rejects(() => sendBackSignoff(hat.sku, "Fix it", actor(adder)), SignoffError, "Only an admin sends back");
  await sendBackSignoff(hat.sku, "Use the red reference, not the blue one", actor(admin));
  const [sentBack] = await db.select().from(assetSignoffs).where(eq(assetSignoffs.assetId, hat.id));
  assert.strictEqual(sentBack.state, "sent_back");
  assert.strictEqual(sentBack.feedback, "Use the red reference, not the blue one");
  const adderMail = await db.select({ subject: emailQueue.subject }).from(emailQueue).where(eq(emailQueue.toEmail, ADDER_EMAIL));
  assert.ok(adderMail.some((m) => m.subject.startsWith("Changes asked for")), "Whoever added it is told");

  await assert.rejects(() => resubmitSignoff(hat.sku, actor(other)), SignoffError, "Only whoever added it resubmits");
  await resubmitSignoff(hat.sku, actor(adder));

  const listedInDigest = await sendSignoffDigest(new Date("2032-03-15T06:30:00Z"), { force: true });
  assert.strictEqual(listedInDigest, 2, "Both are new since the last digest");
  assert.strictEqual(await sendSignoffDigest(new Date("2032-03-15T08:30:00Z")), 0, "Nothing new, no email");
  const digests = await db.select().from(emailQueue).where(and(eq(emailQueue.toEmail, SIGNOFF_DIGEST_TO), like(emailQueue.subject, "%waiting for your sign-off%")));
  assert.strictEqual(digests.length, 1);

  await assert.rejects(() => approveSignoffs([hat.sku], actor(adder)), SignoffError, "Only an admin approves");
  assert.deepStrictEqual(await approveSignoffs([hat.sku], actor(admin)), [hat.sku]);
  const [onBoard] = await db.select().from(assets).where(eq(assets.id, hat.id));
  assert.strictEqual(onBoard.currentStatus, "unassigned", "Approved goes on the board");
  const assignerMail = await db.select({ subject: emailQueue.subject }).from(emailQueue).where(eq(emailQueue.toEmail, ADDER_EMAIL));
  assert.ok(assignerMail.some((m) => m.subject.endsWith("ready to assign")), "The full-time team who assign artists are told it's ready to assign");
  const adminMail = await db.select({ subject: emailQueue.subject }).from(emailQueue).where(eq(emailQueue.toEmail, ADMIN_EMAIL));
  assert.ok(!adminMail.some((m) => m.subject.endsWith("ready to assign")), "Arjun isn't told about his own sign-off");

  await dropSignoff(bag.sku, "Too close to an existing item", actor(admin));
  const [dropped] = await db.select().from(assets).where(eq(assets.id, bag.id));
  assert.ok(dropped.boardHiddenAt, "Dropped is hidden, not deleted");
  assert.strictEqual((await listSignoffs()).filter((i) => i.card.sku.startsWith(SKU_PREFIX)).length, 0, "Neither is listed any more");
  console.log("Confirmed the sign-off flow");
}

async function run() {
  testRules();
  await testFlow();
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All sign-off assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
