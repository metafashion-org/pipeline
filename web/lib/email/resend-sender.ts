import type { emailQueue } from "@/lib/db/schema/email_queue";

// Resend's send endpoint: https://resend.com/docs/api-reference/emails/send-email
const RESEND_SEND_URL = "https://api.resend.com/emails";

/**
 * Whether outgoing email is set up on this deployment.
 *
 * Reads process.env directly rather than ENV from lib/env.ts because the email queue is imported by
 * tests, and lib/env.ts throws when the NextAuth variables CI doesn't set are missing.
 *
 * RESEND_API_KEY is the Resend API key. EMAIL_FROM is the sender, for example
 * "Meta Fashion Pipeline <pipeline@metafashion.in>": its domain has to be verified in Resend, but
 * no mailbox has to exist behind the address. EMAIL_REPLY_TO is optional and is where an artist's
 * reply lands, since nothing reads replies sent to EMAIL_FROM.
 */
export function isEmailSendingConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Sends one queued email through Resend.
 *
 * Input: an email_queue row. Output: Resend's message id, returned in the field the queue already
 * records a provider message id in. Throws on any non-2xx answer, which makes the queue schedule a retry.
 */
export async function sendViaResend(item: typeof emailQueue.$inferSelect): Promise<{ gmailMessageId: string }> {
  const replyTo = process.env.EMAIL_REPLY_TO;
  const res = await fetch(RESEND_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [item.toEmail],
      cc: item.ccEmails && item.ccEmails.length > 0 ? item.ccEmails : undefined,
      reply_to: replyTo || undefined,
      subject: item.subject,
      html: item.bodyHtml,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !body.id) {
    throw new Error(body.message || `Resend answered ${res.status}`);
  }
  return { gmailMessageId: body.id };
}
