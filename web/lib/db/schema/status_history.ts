import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";

export const statusHistory = pgTable("status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorId: uuid("actor_id").references(() => personnel.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // The asset drawer reads one asset's history newest-first on every open.
  index("status_history_asset_created_idx").on(table.assetId, table.createdAt),
]);
