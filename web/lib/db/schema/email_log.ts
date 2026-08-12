import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { emailQueue } from "./email_queue";

export const emailLog = pgTable("email_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  queueId: uuid("queue_id").references(() => emailQueue.id, { onDelete: "set null" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  gmailMessageId: text("gmail_message_id"),
  gmailThreadId: text("gmail_thread_id"),
  status: text("status").notNull(), // 'sent' | 'failed'
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
});
