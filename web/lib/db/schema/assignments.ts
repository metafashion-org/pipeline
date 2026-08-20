import { pgTable, uuid, text, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";

export const assignments = pgTable("assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  artistId: uuid("artist_id").references(() => personnel.id).notNull(),
  assignedBy: uuid("assigned_by").references(() => personnel.id),
  deadline: timestamp("deadline", { withTimezone: true }),
  feeAmount: numeric("fee_amount", { precision: 10, scale: 2 }),
  briefNotes: text("brief_notes"),
  isActive: boolean("is_active").default(true).notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
  unassignedReason: text("unassigned_reason"),
  // P5-T1: AI-generated brief draft. Never canonical on its own - only an explicit
  // accept action (acceptAiBriefDraft in ai/brief-generation-service.ts) copies it
  // into briefNotes above, which is the field the assignment email actually uses.
  aiGeneratedBriefDraft: text("ai_generated_brief_draft"),
  aiBriefGeneratedAt: timestamp("ai_brief_generated_at", { withTimezone: true }),
  aiBriefAcceptedAt: timestamp("ai_brief_accepted_at", { withTimezone: true }),
  aiBriefAcceptedBy: uuid("ai_brief_accepted_by").references(() => personnel.id),
});
