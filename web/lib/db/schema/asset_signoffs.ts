import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";

/**
 * An asset someone other than an admin added, waiting for Arjun's sign-off before it goes on the
 * board, and what he decided. One row per asset; resubmitting after feedback updates it.
 */
export const assetSignoffs = pgTable(
  "asset_signoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
    submittedBy: uuid("submitted_by").references(() => personnel.id, { onDelete: "set null" }),
    // When it was last sent for sign-off: the first add, or the latest resubmission.
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    // 'waiting' | 'sent_back' | 'approved' | 'dropped' (lib/signoff/signoff-rules.ts).
    state: text("state").default("waiting").notNull(),
    feedback: text("feedback"),
    decidedBy: uuid("decided_by").references(() => personnel.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("asset_signoffs_asset_idx").on(table.assetId), index("asset_signoffs_state_idx").on(table.state, table.submittedAt)]
);
