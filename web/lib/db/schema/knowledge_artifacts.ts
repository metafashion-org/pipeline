import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const knowledgeArtifacts = pgTable("knowledge_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  artifactType: text("artifact_type").notNull(), // 'tech_spec' | 'mannequin_rig' | 'recruiting_faq' | 'style_guide'
  fileUrl: text("file_url").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
