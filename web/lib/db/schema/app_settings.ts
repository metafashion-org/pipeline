import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

// App-wide switches an admin flips in Settings without a deploy, one row per switch. Read through
// lib/settings/app-settings.ts, which also holds each switch's default for when its row is missing.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => personnel.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
