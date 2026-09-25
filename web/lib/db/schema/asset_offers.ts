import { pgTable, uuid, text, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { assignments } from "./assignments";
import { personnel } from "./personnel";

// Where an offer stands. 'pending': sent, no answer yet. 'extension_requested': the artist asked
// for a later deadline and the team hasn't decided. 'accepted': agreed, at agreed_deadline.
// 'declined': the artist said no, and the asset went back to Unassigned. 'withdrawn': replaced by
// a newer offer on the same asset (a reassignment, or the offer sent again).
export const OFFER_STATUSES = ["pending", "extension_requested", "accepted", "declined", "withdrawn"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

// The two statuses the artist still has to act on, or the team has to decide.
export const OPEN_OFFER_STATUSES: OfferStatus[] = ["pending", "extension_requested"];

// Whether the team approved a requested deadline. Null until they decide.
export const EXTENSION_DECISIONS = ["approved", "rejected"] as const;
export type ExtensionDecision = (typeof EXTENSION_DECISIONS)[number];

/**
 * One offer of one asset to one artist, and everything that happened to it: the answer, a
 * requested deadline and the team's decision on it, or a decline and its reason. A reassignment
 * withdraws the old offer and adds a new row, so the history is never overwritten.
 */
export const assetOffers = pgTable(
  "asset_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "cascade" }).notNull(),
    assignmentId: uuid("assignment_id").references(() => assignments.id, { onDelete: "set null" }),
    artistId: uuid("artist_id").references(() => personnel.id).notNull(),
    status: text("status").$type<OfferStatus>().notNull().default("pending"),
    // What was offered, frozen at sending time, so a later edit to the asset doesn't rewrite what
    // the artist actually agreed to.
    offeredDeadline: timestamp("offered_deadline", { withTimezone: true }).notNull(),
    feeAmount: numeric("fee_amount", { precision: 10, scale: 2 }),
    currency: text("currency"),
    // Set when the artist asks for more time.
    requestedDeadline: timestamp("requested_deadline", { withTimezone: true }),
    extensionReason: text("extension_reason"),
    extensionDecision: text("extension_decision").$type<ExtensionDecision>(),
    extensionDecidedAt: timestamp("extension_decided_at", { withTimezone: true }),
    extensionDecidedBy: uuid("extension_decided_by").references(() => personnel.id),
    // The deadline both sides agreed to: the offered one on a plain accept, the requested one when
    // the team approves an extension.
    agreedDeadline: timestamp("agreed_deadline", { withTimezone: true }),
    // Optional, and only asked for on a decline.
    declineReason: text("decline_reason"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => personnel.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // An artist's My Tasks reads their open offers; the board and drawer read an asset's latest.
    index("asset_offers_artist_status_idx").on(table.artistId, table.status),
    index("asset_offers_asset_created_idx").on(table.assetId, table.createdAt),
  ]
);
