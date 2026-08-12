import { pgTable, uuid, date, timestamp } from "drizzle-orm/pg-core";

export const paymentCycles = pgTable("payment_cycles", {
  id: uuid("id").primaryKey().defaultRandom(),
  cycleDate: date("cycle_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
