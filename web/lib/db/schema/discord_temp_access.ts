import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// Mirrors the grant shape Catalog Intel's own discord_temp_access.json store
// used exactly (see HANDOFF.md's Discord/personnel migration notes) — same
// fields, now a real table instead of a JSON file, since this app already
// has a real database and doesn't need file-based storage.
export const discordTempAccess = pgTable("discord_temp_access", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: text("channel_id").notNull(),
  channelName: text("channel_name").notNull(),
  granteeType: text("grantee_type").notNull(), // 'user' | 'role'
  granteeId: text("grantee_id").notNull(),
  granteeName: text("grantee_name").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  grantedBy: text("granted_by"), // the granting person's role at grant time (admin/manager)
  // Whatever overwrite (if any) existed for this grantee on this channel
  // BEFORE the grant — revoking restores exactly this rather than deleting
  // the whole overwrite entry outright, which would also destroy any
  // unrelated permission bits already set here for some other reason.
  priorOverwrite: jsonb("prior_overwrite"), // { allow: string, deny: string } | null
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
