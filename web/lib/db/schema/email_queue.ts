import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { assets } from "./assets";

export const emailQueue = pgTable("email_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }),
  toEmail: text("to_email").notNull(),
  ccEmails: text("cc_emails").array().default([]),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  gmailThreadId: text("gmail_thread_id"),
  status: text("status").notNull().default("pending"), // 'pending' | 'sending' | 'sent' | 'failed'
  attemptCount: integer("attempt_count").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(5).notNull(),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});
