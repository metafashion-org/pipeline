import { pgTable, uuid, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { personnel } from "./personnel";

export const marketingUpdates = pgTable("marketing_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
  campaign: text("campaign"),
  platform: text("platform").notNull(),
  // The brief's §10 list names this separately from platform (e.g. Reel /
  // Story / Carousel / Video, as distinct from Instagram / TikTok /
  // YouTube) — was missing entirely.
  postType: text("post_type"),
  postUrl: text("post_url"),
  creative: text("creative"),
  caption: text("caption"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  marketingStatus: text("marketing_status").notNull(),
  metrics: jsonb("metrics").default({}),
  // The brief's Kanban filter list has "High-performing items" alongside
  // "Posted this week" / "Needs repost" — a judgment call layered on top of
  // whatever lifecycle status a post is already in, not a status itself.
  // The brief's own suggested status list (Not Planned...Done) has no
  // "High Performing" entry, so it's a real, separate flag here rather than
  // a status a post has to leave "Posted" to enter.
  highPerforming: boolean("high_performing").default(false).notNull(),
  notes: text("notes"),
  nextAction: text("next_action"),
  responsiblePersonId: uuid("responsible_person_id").references(() => personnel.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
