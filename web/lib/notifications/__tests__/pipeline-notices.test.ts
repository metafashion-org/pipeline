import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { assets } from "@/lib/db/schema/assets";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { notifyArtistOfPayment, notifyReviewersOfReview, notifyUploadersOfReadyAsset } from "../pipeline-notices";

const ARTIST_EMAIL = "test-notice-artist@example.com";
const REVIEWER_EMAIL = "test-notice-reviewer@example.com";
const UPLOADER_EMAIL = "test-notice-uploader@example.com";
const ADMIN_ONLY_EMAIL = "test-notice-admin-only@example.com";
const EMAILS = [ARTIST_EMAIL, REVIEWER_EMAIL, UPLOADER_EMAIL, ADMIN_ONLY_EMAIL];
const SKU = "TEST-NOTICE-001";

async function cleanup() {
  await db.delete(emailQueue).where(inArray(emailQueue.toEmail, EMAILS));
  await db.delete(assets).where(like(assets.sku, "TEST-NOTICE-%"));
  await db.delete(personnel).where(inArray(personnel.email, EMAILS));
}

async function subjectsFor(email: string): Promise<string[]> {
  const rows = await db.select({ subject: emailQueue.subject }).from(emailQueue).where(eq(emailQueue.toEmail, email));
  return rows.map((r) => r.subject);
}

async function testNotices() {
  console.log("Verifying each pipeline notice reaches the right people...");
  await cleanup();
  const [artist] = await db.insert(personnel).values({ name: "Notice Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  await db.insert(personnel).values({ name: "Notice Reviewer", email: REVIEWER_EMAIL, roles: ["admin", "full_time"] });
  await db.insert(personnel).values({ name: "Notice Uploader", email: UPLOADER_EMAIL, roles: ["publisher"] });
  await db.insert(personnel).values({ name: "Admin Login Only", email: ADMIN_ONLY_EMAIL, roles: ["admin"] });
  await db.insert(assets).values({ sku: SKU, itemName: "Notice Test Hat", currentStatus: "in_review", currentArtistId: artist.id, feeAmount: "1500.00", currency: "INR" });

  await notifyReviewersOfReview(SKU);
  assert.deepStrictEqual(await subjectsFor(REVIEWER_EMAIL), ["Ready for review: Notice Test Hat (TEST-NOTICE-001) from Notice Artist"]);
  assert.deepStrictEqual(await subjectsFor(ADMIN_ONLY_EMAIL), [], "An admin login without full_time isn't a reviewer");

  await notifyUploadersOfReadyAsset(SKU);
  assert.deepStrictEqual(await subjectsFor(UPLOADER_EMAIL), ["Ready to upload: Notice Test Hat (TEST-NOTICE-001)"]);

  await notifyArtistOfPayment([SKU]);
  const artistSubjects = await subjectsFor(ARTIST_EMAIL);
  assert.ok(artistSubjects.some((s) => s.startsWith("Paid: 1 asset, ")), `Payment notice missing: ${artistSubjects.join(" | ")}`);
  assert.strictEqual(artistSubjects.length, 1, "The artist hears only about their payment, never about Roblox");
  console.log("Confirmed the pipeline notices");
}

testNotices()
  .then(async () => {
    await cleanup();
    console.log("✓ All pipeline notice assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
