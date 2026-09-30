import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teamNotifications } from "@/lib/db/schema/team_notifications";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { renderEmailLayout, EMAIL_TONE } from "@/lib/email/templates/email-layout";
import { appUrl } from "@/lib/app-url";
import { formatDate } from "@/lib/format-date";
import { postToOfficeChannel } from "@/lib/discord/office-channel";
import { listTeamMembers, personName } from "./team-members";
import { areaLabel, statusLabel, type TeamNotificationKind } from "./task-rules";

// Discord embed colour for Team Tasks posts, as the decimal RGB value the API takes.
const EMBED_COLOR_TEAM = 0x7c3aed;
// How many notifications the page's bell lists.
const NOTIFICATIONS_SHOWN = 30;

/** The Team Tasks page with one task open (the page opens its sheet on ?task=<id>). */
export function teamTaskUrl(taskId: string): string {
  return appUrl(`/team?task=${encodeURIComponent(taskId)}`);
}

export interface TeamNoticeTask {
  id: string;
  title: string;
  area: string;
  status: string;
  dueOn: string | null;
}

export interface TeamNotice {
  recipientId: string;
  actorId: string | null;
  kind: TeamNotificationKind;
  task: TeamNoticeTask;
  /** Someone's own words to show, e.g. the comment they mentioned the recipient in. */
  quote?: string;
}

// The line the recipient reads, e.g. "Arjun mentioned you on Find outfit makers."
function noticeSentence(kind: TeamNotificationKind, actorName: string, taskTitle: string): string {
  return kind === "mention" ? `${actorName} mentioned you on "${taskTitle}".` : `${actorName} gave you a task: "${taskTitle}".`;
}

/**
 * Tells a team member about a task three ways: a row for the page's bell, an email, and a post in
 * the office Discord channel that pings them. Nobody is told about their own action. Never throws:
 * a failed notice must not undo the change that caused it, and each way is tried on its own.
 *
 * Input: who to tell, who did it, why, the task, and any words to quote. Output: nothing.
 */
export async function notifyTeamMember(notice: TeamNotice): Promise<void> {
  if (notice.recipientId === notice.actorId) return;
  try {
    const members = await listTeamMembers();
    const recipient = members.find((m) => m.id === notice.recipientId);
    if (!recipient) return;
    const actorName = (notice.actorId && (members.find((m) => m.id === notice.actorId)?.name ?? (await personName(notice.actorId)))) || "Someone";
    const sentence = noticeSentence(notice.kind, actorName, notice.task.title);
    const url = teamTaskUrl(notice.task.id);

    await db.insert(teamNotifications).values({
      recipientId: recipient.id,
      taskId: notice.task.id,
      kind: notice.kind,
      actorId: notice.actorId,
      message: sentence,
    });

    const emailing = (async () => {
      try {
        await enqueueEmail({
          toEmail: recipient.email,
          subject: sentence,
          bodyHtml: renderEmailLayout({
            preheader: notice.quote ?? sentence,
            eyebrow: notice.kind === "mention" ? "You were mentioned" : "New task for you",
            tone: EMAIL_TONE.neutral,
            title: notice.task.title,
            meta: [areaLabel(notice.task.area), statusLabel(notice.task.status)],
            imageUrl: null,
            stats: [{ label: "Due", value: formatDate(notice.task.dueOn, "No due date") }],
            intro: `Hi ${recipient.name}, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`,
            quote: notice.quote ? { label: actorName, text: notice.quote } : undefined,
            button: { label: "Open the task", url },
            footer: "Sent by Team Tasks on the Meta Fashion pipeline.",
          }),
        });
        await sendDueEmails();
      } catch (error) {
        console.error("[team tasks] email notice failed:", error);
      }
    })();

    const posting = postToOfficeChannel({
      content: recipient.discordUserId ? `<@${recipient.discordUserId}> ${sentence}` : `${recipient.name}: ${sentence}`,
      embeds: [
        {
          title: notice.task.title,
          url,
          color: EMBED_COLOR_TEAM,
          ...(notice.quote ? { description: notice.quote } : {}),
          fields: [
            { name: "Area", value: areaLabel(notice.task.area), inline: true },
            { name: "Status", value: statusLabel(notice.task.status), inline: true },
            { name: "Due", value: formatDate(notice.task.dueOn, "No due date"), inline: true },
          ],
        },
      ],
      mentionDiscordIds: recipient.discordUserId ? [recipient.discordUserId] : [],
      memberDiscordIds: members.map((m) => m.discordUserId).filter((id): id is string => Boolean(id)),
    });

    await Promise.all([emailing, posting]);
  } catch (error) {
    console.error("[team tasks] notice failed:", error);
  }
}

export interface TeamNotificationRow {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  kind: string;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

/** A person's latest notifications and how many are unread. */
export async function listTeamNotifications(personnelId: string): Promise<{ notifications: TeamNotificationRow[]; unread: number }> {
  const [notifications, [unreadRow]] = await Promise.all([
    db
      .select({
        id: teamNotifications.id,
        taskId: teamNotifications.taskId,
        taskTitle: teamTasks.title,
        kind: teamNotifications.kind,
        message: teamNotifications.message,
        readAt: teamNotifications.readAt,
        createdAt: teamNotifications.createdAt,
      })
      .from(teamNotifications)
      .leftJoin(teamTasks, eq(teamTasks.id, teamNotifications.taskId))
      .where(eq(teamNotifications.recipientId, personnelId))
      .orderBy(desc(teamNotifications.createdAt))
      .limit(NOTIFICATIONS_SHOWN),
    db
      .select({ unread: count() })
      .from(teamNotifications)
      .where(and(eq(teamNotifications.recipientId, personnelId), isNull(teamNotifications.readAt))),
  ]);
  return { notifications, unread: unreadRow?.unread ?? 0 };
}

/** Marks all of a person's notifications read. */
export async function markTeamNotificationsRead(personnelId: string): Promise<void> {
  await db
    .update(teamNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(teamNotifications.recipientId, personnelId), isNull(teamNotifications.readAt)));
}
