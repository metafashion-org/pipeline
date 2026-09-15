import { pgTable, uuid, text, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

// One row per "attach payment summary" action — a real payout ledger, replacing
// payment_cycles/payment_cycle_items' role now that payment runs are per-artist and on-demand
// rather than pulled on a 15th/30th schedule. totalAmount and currency are snapshotted at attach
// time for the same reason payment_cycle_items snapshotted feeAmount: so this record doesn't
// silently drift if an asset's fee is edited afterwards.
export const paymentBatches = pgTable(
  "payment_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artistId: uuid("artist_id").notNull().references(() => personnel.id),
    receiptUrl: text("receipt_url").notNull(),
    receiptFileName: text("receipt_file_name"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    assetCount: integer("asset_count").notNull(),
    createdBy: uuid("created_by").references(() => personnel.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("payment_batches_artist_idx").on(table.artistId)]
);
