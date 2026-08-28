import { pgTable, uuid, timestamp, unique } from "drizzle-orm/pg-core";
import { knowledgeArtifacts } from "./knowledge_artifacts";
import { assignments } from "./assignments";

// "Artist briefs" is one of the brief's §7 "attachable to" surfaces. There's
// no standalone "Brief" entity anywhere in the schema - a brief is the
// content of a specific assignment (assignments.briefNotes, deadline, fee),
// so linking an artifact "to a brief" means linking it to a specific
// assignment instance. Distinct from artifact_sku_links: a SKU-level link
// says "relevant to this item in general"; an assignment-level link says
// "specifically included in THIS artist's brief" - useful once a SKU has
// been assigned more than once (reassignment, a second production round)
// and different artifacts apply to different rounds.
export const artifactAssignmentLinks = pgTable(
  "artifact_assignment_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id").notNull().references(() => knowledgeArtifacts.id),
    assignmentId: uuid("assignment_id").notNull().references(() => assignments.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.artifactId, table.assignmentId)]
);
