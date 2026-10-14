import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";

/** One colourway (before upload) or one live listing (after upload) and its suggested name. */
export interface VariantCandidate {
  // Set for kind 'listings': the upload_records id the name is for.
  listingId?: string;
  colour: string;
  name: string;
  // What Claude saw in this variant's image, the evidence for the colour words.
  imageNote: string;
}

export interface NameCandidate {
  name: string;
  why: string;
  // Each word with where Claude says it came from, e.g. "artifact:ANA007", "trend", "images".
  words: { word: string; source: string }[];
}

/**
 * Claude's name suggestions for one asset from one set of inputs, and Arjun's decision. See
 * lib/naming/naming-service.ts.
 */
export const nameProposals = pgTable(
  "name_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
    batchId: uuid("batch_id").notNull(),
    groupKey: text("group_key").notNull(),
    model: text("model").notNull(),
    // 'base' | 'colourways' | 'listings'
    kind: text("kind").default("base").notNull(),
    inputHash: text("input_hash").notNull(),
    // NameCandidate[] for kind 'base'; VariantCandidate[] for 'colourways' and 'listings'.
    candidates: jsonb("candidates").$type<NameCandidate[] | VariantCandidate[]>().default([]).notNull(),
    imageNotes: text("image_notes"),
    // 'pending' | 'approved' | 'superseded' | 'failed'
    status: text("status").default("pending").notNull(),
    chosenName: text("chosen_name"),
    decidedBy: uuid("decided_by").references(() => personnel.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    usage: jsonb("usage").$type<Record<string, number>>().default({}).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("name_proposals_asset_input_idx").on(table.assetId, table.inputHash), index("name_proposals_status_idx").on(table.status)]
);
