import { db } from "@/lib/db/client";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { emailLog } from "@/lib/db/schema/email_log";
import { assets } from "@/lib/db/schema/assets";
import { eq, lte, and } from "drizzle-orm";

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

export async function processEmailQueue(senderFn?: (item: typeof emailQueue.$inferSelect) => Promise<{ gmailMessageId: string; gmailThreadId?: string }>) {
  const pendingItems = await db
    .select()
    .from(emailQueue)
    .where(and(eq(emailQueue.status, "pending"), lte(emailQueue.nextAttemptAt, new Date())))
    .limit(10);

  const results = [];

  for (const item of pendingItems) {
    try {
      // Mark as sending
      await db.update(emailQueue).set({ status: "sending" }).where(eq(emailQueue.id, item.id));

      let sendResult: { gmailMessageId: string; gmailThreadId?: string } = {
        gmailMessageId: `msg_${Date.now()}`,
        gmailThreadId: item.gmailThreadId || `thread_${Date.now()}`,
      };

      if (senderFn) {
        sendResult = await senderFn(item);
      }

      // Mark as sent
      await db
        .update(emailQueue)
        .set({
          status: "sent",
          sentAt: new Date(),
          gmailThreadId: sendResult.gmailThreadId || item.gmailThreadId,
        })
        .where(eq(emailQueue.id, item.id));

      // If asset exists, update asset's stored gmailThreadId and trigger automatic status transition to 'assigned'
      if (item.assetId) {
        await db
          .update(assets)
          .set({
            gmailThreadId: sendResult.gmailThreadId || item.gmailThreadId,
            currentStatus: "assigned",
            updatedAt: new Date(),
          })
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
