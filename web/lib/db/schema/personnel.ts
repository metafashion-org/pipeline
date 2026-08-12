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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
