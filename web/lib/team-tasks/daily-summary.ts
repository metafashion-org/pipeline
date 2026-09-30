import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { renderEmailLayout, EMAIL_TONE, type EmailDetailRow } from "@/lib/email/templates/email-layout";
import { appUrl } from "@/lib/app-url";
import { formatDate } from "@/lib/format-date";
import { postToOfficeChannel } from "@/lib/discord/office-channel";
import { getTeamBoard } from "./team-board";
import type { TeamMember } from "./team-members";
import { BLOCKED_STATUS, DOING_STATUS, DONE_STATUS, STALE_AFTER_DAYS, taskSignals, teamDay } from "./task-rules";

// The day the summary last went out, so a retried cron run doesn't send it twice.
const SUMMARY_SENT_SETTING_KEY = "team_summary_last_sent_on";
const EMBED_COLOR_TEAM = 0x7c3aed;
// Discord refuses an embed field value longer than this.
const DISCORD_FIELD_MAX_CHARS = 1024;

export interface PersonDaySummary {
  member: TeamMember;
  done: string[];
  doing: string[];
  /** Tasks from today's plan that aren't done, in plan order. */
  leftFromPlan: string[];
  blocked: { title: string; waitingOn: string | null }[];
  /** Open tasks nobody has touched for STALE_AFTER_DAYS. */
  staleCount: number;
  /** Today's counted work, e.g. curate 38 of 45, focus Christmas. */
  counted: { title: string; focus: string | null; doneCount: number; targetCount: number }[];
}

/**
 * What each person on the full-time team did today and what's still open, as the 7 pm summary
 * shows it.
 *
 * Input: today's day and the current moment. Output: one summary per team member.
 */
export async function buildDailySummary(today: string, now: Date): Promise<PersonDaySummary[]> {
  const board = await getTeamBoard(today);
  return board.members.map((member) => {
    const own = board.tasks.filter((t) => t.ownerId === member.id);
    const byId = new Map(board.tasks.map((t) => [t.id, t]));
    const plan = board.plans.filter((p) => p.personnelId === member.id).map((p) => byId.get(p.taskId));
    return {
      member,
      done: own.filter((t) => t.status === DONE_STATUS && t.completedAt && teamDay(t.completedAt) === today).map((t) => t.title),
      doing: own.filter((t) => t.status === DOING_STATUS).map((t) => t.title),
      leftFromPlan: plan.filter((t) => t && t.status !== DONE_STATUS).map((t) => t!.title),
      blocked: own.filter((t) => t.status === BLOCKED_STATUS).map((t) => ({ title: t.title, waitingOn: t.waitingOn })),
      staleCount: own.filter((t) => taskSignals(t, today, now).stale).length,
      counted: own
        .filter((t) => t.targetCount !== null && t.occurrenceOn === today)
        .map((t) => ({ title: t.title, focus: t.focus, doneCount: t.doneCount, targetCount: t.targetCount as number })),
    };
  });
}

function countedLine(c: PersonDaySummary["counted"][number]): string {
  return `${c.title}: ${c.doneCount} of ${c.targetCount}${c.focus ? ` (${c.focus})` : ""}`;
}

// The summary as labelled lines, the same for Discord and email. Empty sections are left out.
function summaryLines(summary: PersonDaySummary): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  if (summary.counted.length > 0) lines.push({ label: "Counted", value: summary.counted.map(countedLine).join("; ") });
  if (summary.done.length > 0) lines.push({ label: `Done (${summary.done.length})`, value: summary.done.join("; ") });
  if (summary.doing.length > 0) lines.push({ label: "Doing", value: summary.doing.join("; ") });
  if (summary.leftFromPlan.length > 0) lines.push({ label: "Still on today's plan", value: summary.leftFromPlan.join("; ") });
  if (summary.blocked.length > 0) {
    lines.push({ label: "Blocked", value: summary.blocked.map((b) => (b.waitingOn ? `${b.title} (waiting on ${b.waitingOn})` : b.title)).join("; ") });
  }
  if (summary.staleCount > 0) lines.push({ label: `Not updated in ${STALE_AFTER_DAYS}+ days`, value: `${summary.staleCount} task${summary.staleCount === 1 ? "" : "s"}` });
  return lines;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

async function lastSentOn(): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SUMMARY_SENT_SETTING_KEY)).limit(1);
  return typeof row?.value === "string" ? row.value : null;
}

/**
 * Posts the day's summary in the office Discord channel and emails it to everyone on the full-time
 * team. Sent once a day: a second call on the same day does nothing.
 *
 * Input: today's day and the current moment. Output: whether it was sent, and how many people it covered.
 */
export async function sendDailySummary(today: string, now: Date): Promise<{ sent: boolean; people: number }> {
  if ((await lastSentOn()) === today) return { sent: false, people: 0 };
  const summaries = await buildDailySummary(today, now);
  if (summaries.length === 0) return { sent: false, people: 0 };

  // Recorded first, so a crash halfway doesn't send the half that went out twice.
  await db
    .insert(appSettings)
    .values({ key: SUMMARY_SENT_SETTING_KEY, value: today })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: today, updatedAt: now } });

  const dayLabel = formatDate(today);
  const boardUrl = appUrl("/team");
  const memberDiscordIds = summaries.map((s) => s.member.discordUserId).filter((id): id is string => Boolean(id));

  await postToOfficeChannel({
    content: `Team Tasks for ${dayLabel}. Open the board: ${boardUrl}`,
    embeds: summaries.map((summary) => {
      const lines = summaryLines(summary);
      return {
        title: summary.member.name,
        color: EMBED_COLOR_TEAM,
        ...(lines.length === 0 ? { description: "Nothing on the board today." } : {}),
        fields: lines.map((line) => ({ name: line.label, value: truncate(line.value, DISCORD_FIELD_MAX_CHARS) })),
      };
    }),
    mentionDiscordIds: [],
    memberDiscordIds,
  });

  const details: EmailDetailRow[] = summaries.flatMap((summary) => {
    const lines = summaryLines(summary);
    if (lines.length === 0) return [{ label: summary.member.name, value: "Nothing on the board today." }];
    return lines.map((line) => ({ label: `${summary.member.name}: ${line.label}`, value: line.value }));
  });
  const bodyHtml = renderEmailLayout({
    preheader: `What the team did on ${dayLabel}.`,
    eyebrow: "Team Tasks",
    tone: EMAIL_TONE.neutral,
    title: `The team's day, ${dayLabel}`,
    meta: [],
    imageUrl: null,
    stats: [
      { label: "Done today", value: String(summaries.reduce((sum, s) => sum + s.done.length, 0)) },
      { label: "Blocked", value: String(summaries.reduce((sum, s) => sum + s.blocked.length, 0)) },
    ],
    intro: "Here is what everyone finished today, what they're on, and what's stuck.",
    details,
    button: { label: "Open Team Tasks", url: boardUrl },
    footer: "Sent at 7 pm by Team Tasks on the Meta Fashion pipeline.",
  });
  try {
    for (const summary of summaries) {
      await enqueueEmail({ toEmail: summary.member.email, subject: `Team Tasks: ${dayLabel}`, bodyHtml });
    }
    await sendDueEmails();
  } catch (error) {
    console.error("[team tasks] summary email failed:", error);
  }

  await db.insert(auditLog).values({
    action: "sendTeamSummary",
    entityType: "team_summary",
    entityId: today,
    payload: { people: summaries.length },
  });
  return { sent: true, people: summaries.length };
}
