import assert from "node:assert";
import { processEmailQueue, enqueueEmail } from "../queue-worker";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { emailLog } from "@/lib/db/schema/email_log";
import { eq } from "drizzle-orm";

const TEST_SKU = "TEST-EMAIL-TRANSITION-SKU";
const TEST_EMAIL = "test-email-transition@example.com";

async function cleanup() {
  await db.delete(emailLog).where(eq(emailLog.toEmail, TEST_EMAIL));
  await db.delete(emailQueue).where(eq(emailQueue.toEmail, TEST_EMAIL));
  await db.delete(assets).where(eq(assets.sku, TEST_SKU));
}

async function testEmailStatusTransition() {
  console.log("Verifying a queued email is sent and logged, and leaves the asset's status alone...");

  await cleanup();

  // currentStatus defaults to "unassigned" and must still be that after the send.
  const [asset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU, itemName: "Email Transition Test Asset" })
    .returning();

  try {
    const queued = await enqueueEmail({
      assetId: asset.id,
      toEmail: TEST_EMAIL,
      subject: "Test assignment email",
      bodyHtml: "<p>Test</p>",
    });

    // A stand-in sender, so no real email leaves the test.
    const results = await processEmailQueue(async () => ({ gmailMessageId: "test-message-id" }));
    const ourResult = results.find((r) => r.id === queued.id);
    assert.ok(ourResult, "processEmailQueue() result should include our queued item");
    assert.strictEqual(ourResult.status, "sent", "Our queued item should be marked sent");

    const [queueRow] = await db.select().from(emailQueue).where(eq(emailQueue.id, queued.id)).limit(1);
    assert.ok(queueRow, "Queue row should still exist");
    assert.strictEqual(queueRow.status, "sent", "email_queue row status should flip to sent");

    const logRows = await db.select().from(emailLog).where(eq(emailLog.queueId, queued.id));
    assert.strictEqual(logRows.length, 1, "Exactly one email_log row should be written for our queue item");
    assert.strictEqual(logRows[0].status, "sent", "email_log row status should be sent");

    // Sending an email must not move the asset. Assigning does that itself, through the transition
    // rules; the queue used to set "assigned" on every send, for any email about any asset.
    const [updatedAsset] = await db.select().from(assets).where(eq(assets.id, asset.id)).limit(1);
    assert.strictEqual(updatedAsset.currentStatus, "unassigned", "Sending an email must not change the asset's status");

    console.log("✓ All email queue assertions passed cleanly!");
  } finally {
    await cleanup();
  }
}

testEmailStatusTransition()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
