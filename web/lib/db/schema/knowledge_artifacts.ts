import { pgTable, uuid, text, timestamp, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
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
  // The per-type fields that have no column of their own, keyed as lib/knowledge/artifact-forms.ts
  // defines them: a prompt's chatLink and inputs, an insight's seenOn and attachments, a trend
  // brief's season.
  details: jsonb("details").$type<Record<string, unknown>>().default({}).notNull(),
  // The Trend Brief this moodboard or recolor kit came from.
  trendArtifactId: uuid("trend_artifact_id").references((): AnyPgColumn => knowledgeArtifacts.id, { onDelete: "set null" }),
  // Set when someone takes the artifact out of the Registry. Nothing is deleted and the ID stays claimed.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: uuid("archived_by").references(() => personnel.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), // doubles as "Date added"
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
