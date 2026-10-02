import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

/**
 * A change an artist asked for to details they already saved, with their reason. It replaces the
 * saved details only once someone who pays artists approves it.
 */
export const artistProfileChangeRequests = pgTable(
  "artist_profile_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personnelId: uuid("personnel_id").references(() => personnel.id, { onDelete: "cascade" }).notNull(),
    // The new values, keyed like ArtistDetailsInput in lib/artist-details/details-rules.ts.
    changes: jsonb("changes").$type<Record<string, string | null>>().notNull(),
    reason: text("reason").notNull(),
    // A key of CHANGE_REQUEST_STATUSES in lib/artist-details/details-rules.ts.
    status: text("status").default("pending").notNull(),
    decidedBy: uuid("decided_by").references(() => personnel.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("artist_profile_change_requests_status_idx").on(table.status, table.personnelId)]
);
