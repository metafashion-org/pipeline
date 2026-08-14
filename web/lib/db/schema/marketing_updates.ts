import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";

export const marketingUpdates = pgTable("marketing_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  campaign: text("campaign"),
  platform: text("platform").notNull(),
  postUrl: text("post_url"),
  creative: text("creative"),
  caption: text("caption"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  marketingStatus: text("marketing_status").notNull(),
  metrics: jsonb("metrics").default({}),
  notes: text("notes"),
  nextAction: text("next_action"),
  responsiblePersonId: uuid("responsible_person_id").references(() => personnel.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
