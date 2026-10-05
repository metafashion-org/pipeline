// The sign-off emails and Discord messages: telling whoever added an asset what Arjun decided, and
// the digest of new assets waiting for him. Best-effort: a notice that fails never undoes a decision.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { EMAIL_IMAGE_WIDTH_PX, EMAIL_TONE, renderEmailLayout } from "@/lib/email/templates/email-layout";
import { discordFetch, isConfigured as isDiscordConfigured } from "@/lib/discord/discord-service";
import { parseDriveRefs, driveThumbnailUrl } from "@/lib/assets/drive-links";
import { formatDateTime } from "@/lib/format-date";
import { appUrl } from "@/lib/app-url";
import { SIGNOFF_DIGEST_TO } from "./signoff-rules";

/** The Sign-off page. */
export function signoffUrl(): string {
  return appUrl("/admin/signoff");
}

// The board opens an asset's drawer from ?asset=<SKU>.
function boardAssetUrl(sku: string): string {
  return appUrl(`/admin/board?asset=${encodeURIComponent(sku)}`);
}

async function queueAndSend(toEmail: string, subject: string, bodyHtml: string): Promise<void> {
  try {
    await enqueueEmail({ toEmail, subject, bodyHtml });
    await sendDueEmails();
  } catch (error) {
    console.error("[sign-off] email failed:", error);
  }
}

// A direct message from the bot. People who add assets are on the team, not artists, so this is a
// DM rather than a post in an artist channel.
async function directMessage(discordUserId: string | null, content: string): Promise<void> {
  if (!discordUserId || !isDiscordConfigured()) return;
  try {
    const dm = await discordFetch<{ id: string }>("/users/@me/channels", { method: "POST", body: JSON.stringify({ recipient_id: discordUserId }) });
    await discordFetch(`/channels/${dm.id}/messages`, { method: "POST", body: JSON.stringify({ content }) });
  } catch (error) {
    console.error("[sign-off] Discord message failed:", error);
  }
}

export interface SignoffDecisionNotice {
  submitterId: string | null;
  sku: string;
  itemName: string;
  decision: "approved" | "sent_back" | "dropped";
  /** Arjun's feedback (sent back) or reason (dropped). */
  feedback: string | null;
}

const DECISION_WORDING = {
  approved: { eyebrow: "Signed off", subject: "Signed off", line: "is signed off and on the board in Unassigned, ready to assign." },
  sent_back: { eyebrow: "Changes asked for", subject: "Changes asked for", line: "needs changes before it goes on the board. Make them, then resubmit it on the Sign-off page." },
  dropped: { eyebrow: "Dropped", subject: "Dropped", line: "won't go on the board. It's hidden, not deleted." },
} as const;

/** Tells whoever added an asset what Arjun decided, by email and Discord DM. Never throws. */
export async function notifySubmitterOfDecision(notice: SignoffDecisionNotice): Promise<void> {
  try {
    if (!notice.submitterId) return;
    const [person] = await db
      .select({ name: personnel.name, email: personnel.email, discordUserId: personnel.discordUserId, status: personnel.status })
      .from(personnel)
      .where(eq(personnel.id, notice.submitterId))
      .limit(1);
    if (!person || person.status !== "Active") return;
    const words = DECISION_WORDING[notice.decision];
    const url = notice.decision === "approved" ? boardAssetUrl(notice.sku) : signoffUrl();
    await Promise.all([
      queueAndSend(
        person.email,
        `${words.subject}: ${notice.itemName} (${notice.sku})`,
        renderEmailLayout({
          preheader: `${notice.itemName} ${words.line}`,
          eyebrow: words.eyebrow,
          tone: notice.decision === "approved" ? EMAIL_TONE.good : EMAIL_TONE.neutral,
          title: notice.itemName,
          meta: [notice.sku],
          imageUrl: null,
          stats: [],
          intro: `Hi ${person.name}, ${notice.itemName} ${words.line}`,
          quote: notice.feedback ? { label: notice.decision === "sent_back" ? "Arjun's feedback" : "Why", text: notice.feedback } : undefined,
          button: { label: notice.decision === "approved" ? "Open it on the board" : "Open the Sign-off page", url },
        })
      ),
      directMessage(
        person.discordUserId,
        `**${words.eyebrow}:** ${notice.itemName} (${notice.sku}) ${words.line}${notice.feedback ? `\n> ${notice.feedback.replace(/\n/g, "\n> ")}` : ""}\n${url}`
      ),
    ]);
  } catch (error) {
    console.error(`[sign-off] notice for ${notice.sku} failed:`, error);
  }
}

export interface DigestItem {
  sku: string;
  itemName: string;
  category: string | null;
  referenceImages: unknown;
  submittedAt: Date;
  submittedByName: string | null;
}

/** Emails Arjun the assets newly waiting for his sign-off. Never throws. */
export async function sendSignoffDigestEmail(items: DigestItem[], waitingTotal: number): Promise<void> {
  const firstImage = items.map((i) => parseDriveRefs(i.referenceImages).find((ref) => ref.fileId)).find(Boolean);
  await queueAndSend(
    SIGNOFF_DIGEST_TO,
    `${items.length} new asset${items.length === 1 ? "" : "s"} waiting for your sign-off`,
    renderEmailLayout({
      preheader: `${waitingTotal} waiting in all. Approve them onto the board, send them back, or drop them.`,
      eyebrow: "Sign-off",
      tone: EMAIL_TONE.neutral,
      title: `${items.length} new since the last summary`,
      meta: [`${waitingTotal} waiting in all`],
      imageUrl: firstImage?.fileId ? driveThumbnailUrl(firstImage.fileId, EMAIL_IMAGE_WIDTH_PX) : null,
      stats: [],
      intro: "These were added to the Kanban and are waiting for you before they go on the board.",
      details: items.map((i) => ({
        label: i.sku,
        value: `${i.itemName}${i.category ? ` · ${i.category}` : ""} · added by ${i.submittedByName ?? "someone"}, ${formatDateTime(i.submittedAt)}`,
      })),
      button: { label: "Open the Sign-off page", url: signoffUrl() },
    })
  );
}
