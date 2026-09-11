import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

// One review list for every way someone can ask to join, whatever route they came in by.
//
// Before this there were two, and only one of them was a list. An access request submitted through
// the public form landed in form_submissions and showed up on /admin/personnel. Someone who turned
// up in the Discord server with no role assigned appeared only as a number on the Discord panel
// ("Pending (no role bucket)") and had to be spotted by eye. Nothing tied the two together, so the
// same person applying by form and joining Discord was two unconnected pieces of state.
//
// This table is the one place both land. Rows are only ever created as 'pending': syncing pulls
// requests in, it never grants anyone anything. An admin decides each one, and the decision is
// written back to wherever the request came from — see approveOnboardingRequest and
// rejectOnboardingRequest in lib/personnel/onboarding-sync.ts.
export const onboardingRequests = pgTable(
  "onboarding_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 'email' for a form submission (the artist access form, whose submitter reaches us by email),
    // 'discord' for someone in the guild with no role. Plain text rather than a Postgres enum so
    // adding a third route later is an insert, not a type migration.
    source: text("source").notNull(),
    // The id this request has in the system it came from: form_submissions.id for 'email', the
    // Discord user snowflake for 'discord'. Together with source it is what makes syncing
    // idempotent — running the sync twice updates the same row instead of adding a second one.
    externalId: text("external_id").notNull(),
    name: text("name"),
    email: text("email"),
    discordUserId: text("discord_user_id"),
    discordUsername: text("discord_username"),
    // Whatever else the source carried: the form's answers, or the member's Discord roles and nick.
    details: jsonb("details").notNull().default({}),
    // 'pending' | 'approved' | 'rejected'. Only an admin's decision moves it off 'pending'.
    status: text("status").notNull().default("pending"),
    // Set once approved, pointing at the personnel row this request produced.
    personnelId: uuid("personnel_id").references(() => personnel.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => personnel.id),
    reviewNotes: text("review_notes"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // When the sync first saw this request, which is not the same as when the person asked — a
    // request made before this table existed is first seen the day the sync first runs.
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    // When the request was actually made at its source, when the source knows: the submission's
    // created_at for a form, null for a Discord member (Discord does not report a join date here).
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // What makes the sync idempotent: one row per request per source.
    uniqueIndex("onboarding_requests_source_external_idx").on(table.source, table.externalId),
    // The review list reads pending requests, oldest first.
    index("onboarding_requests_status_idx").on(table.status, table.firstSeenAt),
  ]
);
