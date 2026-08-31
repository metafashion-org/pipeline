import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { artifactTypeConfig } from "./artifact_type_config";
import { personnel } from "./personnel";

// Redesigned per the brief's §7 (was: a fixed 4-category free-text field,
// no ID system at all — see HANDOFF.md). artifactId (e.g. "TR001") is
// auto-generated on submission and permanent once assigned; see
// lib/knowledge/artifact-id-service.ts for the generation logic.
export const knowledgeArtifacts = pgTable("knowledge_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  artifactId: text("artifact_id").notNull().unique(), // "TR001" — permanent once assigned, never reused even if this row is later deleted
  artifactTypeId: uuid("artifact_type_id").notNull().references(() => artifactTypeConfig.id),
  title: text("title").notNull(),
  description: text("description"),
  source: text("source"),
  fileUrl: text("file_url"), // nullable: not every artifact type needs a file (e.g. a Prompt may be text-only)
  tags: text("tags").array().default([]), // covers both general tags and the brief's "aesthetic/style tags" — see HANDOFF.md's scoping note
  addedBy: uuid("added_by").references(() => personnel.id),
  usageNotes: text("usage_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), // doubles as "Date added"
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
