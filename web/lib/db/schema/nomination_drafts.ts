import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { assets } from "./assets";
import { personnel } from "./personnel";

/**
 * One Today's Picks nomination attempt of an asset: Arjun's reviewed form answers and final name,
 * and, once he confirms he filed it on Roblox's form, when and by whom. See
 * lib/marketing/nomination-service.ts.
 */
export const nominationDrafts = pgTable(
  "nomination_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
    // 1 for the first nomination; higher for a re-nomination after a change.
    attemptNo: integer("attempt_no").notNull(),
    // 'draft' | 'submitted' | 'withdrawn'. Only Arjun's confirmation sets 'submitted'.
    state: text("state").default("draft").notNull(),
    formVersion: text("form_version").notNull(),
    fields: jsonb("fields").$type<Record<string, string>>().default({}).notNull(),
    renominationReason: text("renomination_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => personnel.id, { onDelete: "set null" }),
    // What Arjun has as proof, e.g. "Confirmation page seen" or a screenshot link. Roblox sends no receipt.
    submissionEvidence: text("submission_evidence"),
    createdBy: uuid("created_by").references(() => personnel.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("nomination_drafts_asset_attempt_idx").on(table.assetId, table.attemptNo),
    uniqueIndex("nomination_drafts_one_open_idx").on(table.assetId).where(sql`${table.state} = 'draft'`),
  ]
);

/** Append-only history of a nomination attempt. (draftId, eventKey) is unique, so a retry records nothing twice. */
export const nominationEvents = pgTable(
  "nomination_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id").references(() => nominationDrafts.id, { onDelete: "cascade" }).notNull(),
    eventKey: text("event_key").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    actorId: uuid("actor_id").references(() => personnel.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("nomination_events_draft_key_idx").on(table.draftId, table.eventKey)]
);
