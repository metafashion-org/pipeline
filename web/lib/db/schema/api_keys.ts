import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

/**
 * A key an outside tool (Instinct, the AI assistant) sends instead of signing in. Only the SHA-256
 * hash is stored. The key acts as `personnelId`, so its tasks show who added them.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    personnelId: uuid("personnel_id").references(() => personnel.id, { onDelete: "cascade" }).notNull(),
    keyHash: text("key_hash").notNull(),
    // The first characters of the key, so Settings can show which key is which without storing it.
    keyPrefix: text("key_prefix").notNull(),
    createdBy: uuid("created_by").references(() => personnel.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("api_keys_key_hash_idx").on(table.keyHash)]
);
