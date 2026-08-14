import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { personnel } from "./personnel";

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  actorId: uuid("actor_id").references(() => personnel.id),
  payload: jsonb("payload").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
