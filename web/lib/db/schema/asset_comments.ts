import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { assets } from "./assets";

/** A note or a question on an asset's card. Everyone @mentioned in it, team or freelancer, is notified. */
export const assetComments = pgTable(
  "asset_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
    authorId: uuid("author_id").references(() => personnel.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    mentionedIds: uuid("mentioned_ids").array().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("asset_comments_asset_idx").on(table.assetId, table.createdAt)]
);
