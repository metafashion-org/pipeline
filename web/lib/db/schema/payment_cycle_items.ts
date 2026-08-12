import { pgTable, uuid, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { paymentCycles } from "./payment_cycles";
import { assets } from "./assets";

// Snapshots sku/feeAmount/currency at pull time so a cycle's historical record
// doesn't silently change if the asset's fee is edited after the pull ran.
export const paymentCycleItems = pgTable("payment_cycle_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  cycleId: uuid("cycle_id").references(() => paymentCycles.id, { onDelete: "cascade" }).notNull(),
  assetId: uuid("asset_id").references(() => assets.id).notNull(),
  sku: text("sku").notNull(),
  feeAmount: numeric("fee_amount", { precision: 10, scale: 2 }),
  currency: text("currency"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
