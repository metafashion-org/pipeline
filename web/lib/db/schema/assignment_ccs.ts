import { pgTable, uuid, text } from "drizzle-orm/pg-core";
import { assignments } from "./assignments";
import { personnel } from "./personnel";

export const assignmentCcs = pgTable("assignment_ccs", {
  id: uuid("id").primaryKey().defaultRandom(),
  assignmentId: uuid("assignment_id").references(() => assignments.id, { onDelete: "cascade" }).notNull(),
  personnelId: uuid("personnel_id").references(() => personnel.id),
  email: text("email").notNull(),
});
