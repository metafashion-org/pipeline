import { pgTable, uuid, text, timestamp, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  sku: text("sku").notNull().unique(),
  itemName: text("item_name").notNull(),
  category: text("category"),
  currentStatus: text("current_status").notNull().default("unassigned"),
  currentArtistId: uuid("current_artist_id").references(() => personnel.id),
  deadline: timestamp("deadline", { withTimezone: true }),
  feeAmount: numeric("fee_amount", { precision: 10, scale: 2 }),
  currency: text("currency").default("INR"), // MetaFashion pays in INR by default; USD/EUR/RUB stay selectable for artists paid elsewhere.
  paymentReceiptUrl: text("payment_receipt_url"),
  marketingStatus: text("marketing_status"),
  lastMarketingUpdate: timestamp("last_marketing_update", { withTimezone: true }),
  gmailThreadId: text("gmail_thread_id"),
  rootMessageId: text("root_message_id"),
  replyToMessageId: text("reply_to_message_id"),
  referenceImages: jsonb("reference_images").default([]), // Array of FileStore objects: { provider, externalId, sizeBytes, mimeType }
  recolorReferenceImages: jsonb("recolor_reference_images").default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // The board groups every asset by status, and the artist board filters by assignee. Both
  // were sequential scans; sku already has one from its unique constraint.
  index("assets_current_status_idx").on(table.currentStatus),
  index("assets_current_artist_idx").on(table.currentArtistId),
]);
