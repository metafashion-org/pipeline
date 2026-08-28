import { pgTable, uuid, text, boolean, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const personnelStatusEnum = pgEnum("personnel_status", ["Active", "Blacklisted", "Inactive"]);

export const personnel = pgTable("personnel", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  roles: text("roles").array().notNull().default([]), // Multi-valued role support: ['admin', 'artist', 'publisher', etc.]
  status: personnelStatusEnum("status").notNull().default("Active"),
  skills: text("skills").array().default([]),
  agreementSigned: boolean("agreement_signed").default(false),
  agreementDocLink: text("agreement_doc_link"),
  dateOnboarded: timestamp("date_onboarded", { withTimezone: true }),
  notes: text("notes"),
  defaultCc: text("default_cc"),
  profilePhotoUrl: text("profile_photo_url"),
  capabilityOverrides: jsonb("capability_overrides").default({}), // Per-person overrides: e.g. { canAssignArtists: true, canApprove: true }
  discordUserId: text("discord_user_id"), // Real Discord account snowflake ID — links this person to the Discord/personnel migration (see HANDOFF.md). Nullable: not everyone has linked their Discord yet.
  discordChannelId: text("discord_channel_id"), // This person's "Artist: {Name}" channel id, so Kanban cards can deep-link straight to it instead of hitting the Discord API per card render.
  discordPriorCategoryId: text("discord_prior_category_id"), // Set only while their channel sits in "📦 Archive" because status went Inactive/Blacklisted — the category it lived in before, so reactivating them (back to Active) restores it there instead of guessing. Null the rest of the time.
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
