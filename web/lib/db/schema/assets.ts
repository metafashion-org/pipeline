import { pgTable, uuid, text, timestamp, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";
import { brandGroups } from "./brand_groups";
import { paymentBatches } from "./payment_batches";

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  sku: text("sku").notNull().unique(),
  itemName: text("item_name").notNull(),
  category: text("category"),
  currentStatus: text("current_status").notNull().default("unassigned"),
  currentArtistId: uuid("current_artist_id").references(() => personnel.id),
  // Which Roblox creator group/brand this asset gets uploaded under — the uploader's own queue
  // reads and surfaces this directly, since it's specifically for them.
  brandGroupId: uuid("brand_group_id").references(() => brandGroups.id),
  deadline: timestamp("deadline", { withTimezone: true }),
  feeAmount: numeric("fee_amount", { precision: 10, scale: 2 }),
  currency: text("currency").default("INR"), // MetaFashion pays in INR by default; USD/EUR/RUB stay selectable for artists paid elsewhere.
  paymentReceiptUrl: text("payment_receipt_url"),
  // Which payout this asset was paid under, once it has been — set together with
  // paymentReceiptUrl when a payment_admin attaches a payment summary for the artist. Null for
  // anything not yet paid, and for anything paid before this column existed.
  paymentBatchId: uuid("payment_batch_id").references(() => paymentBatches.id),
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
  index("assets_brand_group_idx").on(table.brandGroupId),
  index("assets_payment_batch_idx").on(table.paymentBatchId),
]);
