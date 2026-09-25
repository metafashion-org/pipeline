import { db } from "@/lib/db/client";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { emailLog } from "@/lib/db/schema/email_log";
import { assets } from "@/lib/db/schema/assets";
import { eq, lte, and } from "drizzle-orm";
import { isEmailSendingConfigured, sendViaResend } from "./resend-sender";

export type EmailSender = (item: typeof emailQueue.$inferSelect) => Promise<{ gmailMessageId: string; gmailThreadId?: string }>;

// How many due emails one run of the queue sends. Sends are sequential, so this bounds how long a
// request that triggers a run can take.
const EMAILS_PER_RUN = 10;

export interface EnqueueEmailOptions {
  assetId?: string;
  toEmail: string;
  ccEmails?: string[];
  subject: string;
  bodyHtml: string;
  gmailThreadId?: string;
}

export async function enqueueEmail(options: EnqueueEmailOptions) {
  const { assetId, toEmail, ccEmails = [], subject, bodyHtml, gmailThreadId } = options;

  let threadIdToUse = gmailThreadId || null;

  // If assetId given and no threadId provided, reuse asset's existing thread ID
  if (assetId && !threadIdToUse) {
    const asset = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    if (asset.length > 0 && asset[0].gmailThreadId) {
      threadIdToUse = asset[0].gmailThreadId;
    }
  }

  const [queued] = await db
    .insert(emailQueue)
    .values({
      assetId: assetId || null,
      toEmail: toEmail.trim().toLowerCase(),
      ccEmails: ccEmails.flatMap((e) => {
        const normalized = e.trim().toLowerCase();
        return normalized ? [normalized] : [];
      }),
      subject,
      bodyHtml,
      gmailThreadId: threadIdToUse,
      status: "pending",
      attemptCount: 0,
      maxAttempts: 5,
      nextAttemptAt: new Date(),
    })
    .returning();

  return queued;
}

/**
 * Sends every due email in the queue, up to EMAILS_PER_RUN, through `senderFn`.
 *
 * Input: the function that actually delivers one email. Output: one result per email attempted.
 *
 * The sender is required. This used to fall back to a fake sender when none was passed, which
 * marked emails "sent" that nobody ever received. It also used to set the linked asset's status to
 * "assigned" on every send. That skipped the transition rules and status history, and would have
 * pulled any asset that got an email, not only a new assignment, back to Assigned. Assigning moves
 * the asset itself (app/api/assets/[skuId]/assign/route.ts), so sending no longer touches status.
 */
export async function processEmailQueue(senderFn: EmailSender) {
  const pendingItems = await db
    .select()
    .from(emailQueue)
    .where(and(eq(emailQueue.status, "pending"), lte(emailQueue.nextAttemptAt, new Date())))
    .limit(EMAILS_PER_RUN);

  const results = [];

  for (const item of pendingItems) {
    try {
      // Mark as sending
      await db.update(emailQueue).set({ status: "sending" }).where(eq(emailQueue.id, item.id));

      const sendResult = await senderFn(item);

      // Mark as sent
      await db
        .update(emailQueue)
        .set({
          status: "sent",
          sentAt: new Date(),
          gmailThreadId: sendResult.gmailThreadId || item.gmailThreadId,
        })
        .where(eq(emailQueue.id, item.id));

      if (item.assetId && sendResult.gmailThreadId) {
        await db
          .update(assets)
          .set({ gmailThreadId: sendResult.gmailThreadId, updatedAt: new Date() })
          .where(eq(assets.id, item.assetId));
      }

      // Log success
      await db.insert(emailLog).values({
        queueId: item.id,
        assetId: item.assetId,
        toEmail: item.toEmail,
        subject: item.subject,
        gmailMessageId: sendResult.gmailMessageId,
        gmailThreadId: sendResult.gmailThreadId || item.gmailThreadId,
        status: "sent",
      });

      results.push({ id: item.id, status: "sent" });
    } catch (err: any) {
      const attempts = item.attemptCount + 1;
      const isFinalFail = attempts >= item.maxAttempts;
      const nextDelaySeconds = Math.pow(2, attempts) * 5; // Exponential backoff

      await db
        .update(emailQueue)
        .set({
          status: isFinalFail ? "failed" : "pending",
          attemptCount: attempts,
          lastError: err.message || "Email dispatch failed",
          nextAttemptAt: new Date(Date.now() + nextDelaySeconds * 1000),
        })
        .where(eq(emailQueue.id, item.id));

      if (isFinalFail) {
        await db.insert(emailLog).values({
          queueId: item.id,
          assetId: item.assetId,
          toEmail: item.toEmail,
          subject: item.subject,
          status: "failed",
        });
      }

      results.push({ id: item.id, status: isFinalFail ? "failed" : "retry_scheduled", error: err.message });
    }
  }

  return results;
}

/**
 * Sends whatever is due in the queue through Resend, when Resend is set up.
 *
 * Input: none. Output: the results of the run, or an empty list when sending isn't configured.
 * Without configuration the emails stay "pending" rather than being marked sent, so they go out
 * once RESEND_API_KEY and EMAIL_FROM are added. Called right after something is queued, and by
 * the daily cron at /api/cron/email-queue, which retries anything that failed.
 */
export async function sendDueEmails() {
  if (!isEmailSendingConfigured()) {
    console.warn("[email] RESEND_API_KEY / EMAIL_FROM not set — emails stay queued until they are.");
    return [];
  }
  return processEmailQueue(sendViaResend);
}
