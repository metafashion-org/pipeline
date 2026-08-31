import { db } from "@/lib/db/client";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, asc, and, SQL } from "drizzle-orm";
import { claimNextArtifactId } from "./artifact-id-service";

// Replaces the old hardcoded 4-type prefix map (tech_spec/mannequin_rig/
// recruiting_faq/style_guide) and the old ID format ("SPEC-0001", found by
// re-parsing existing titles for the highest number). Per the brief's §7:
// the prefix list is admin-configurable (artifact_type_config), IDs are a
// real dedicated column (not embedded in the title text), and the number
// is claimed atomically (see artifact-id-service.ts) rather than found by
// scanning. See HANDOFF.md for the full writeup of what was wrong before.

export async function listArtifactTypes() {
  return db.select().from(artifactTypeConfig).orderBy(asc(artifactTypeConfig.sortOrder));
}

export interface CreateArtifactOptions {
  artifactTypeId: string;
  title: string;
  description?: string;
  source?: string;
  fileUrl?: string;
  tags?: string[];
  addedBy?: string;
  usageNotes?: string;
  actorId?: string;
}

export async function createKnowledgeArtifact(options: CreateArtifactOptions) {
  const { artifactTypeId, title, description, source, fileUrl, tags, addedBy, usageNotes, actorId } = options;

  const generatedId = await claimNextArtifactId(artifactTypeId);

  const [artifact] = await db
    .insert(knowledgeArtifacts)
    .values({
      artifactId: generatedId,
      artifactTypeId,
      title,
      description: description || null,
      source: source || null,
      fileUrl: fileUrl || null,
      tags: tags || [],
      addedBy: addedBy || null,
      usageNotes: usageNotes || null,
    })
    .returning();

  await db.insert(auditLog).values({
    action: "createKnowledgeArtifact",
    entityType: "knowledge_artifact",
    entityId: artifact.id,
    actorId: actorId || null,
    payload: { generatedId, artifactTypeId, title },
  });

  return artifact;
}

export async function getKnowledgeArtifacts(artifactTypeId?: string) {
  const conditions: SQL[] = [];
  if (artifactTypeId) conditions.push(eq(knowledgeArtifacts.artifactTypeId, artifactTypeId));

  return db
    .select({
      id: knowledgeArtifacts.id,
      artifactId: knowledgeArtifacts.artifactId,
      title: knowledgeArtifacts.title,
      description: knowledgeArtifacts.description,
      source: knowledgeArtifacts.source,
      fileUrl: knowledgeArtifacts.fileUrl,
      tags: knowledgeArtifacts.tags,
      usageNotes: knowledgeArtifacts.usageNotes,
      createdAt: knowledgeArtifacts.createdAt,
      typeLabel: artifactTypeConfig.label,
      typePrefix: artifactTypeConfig.prefix,
    })
    .from(knowledgeArtifacts)
    .innerJoin(artifactTypeConfig, eq(knowledgeArtifacts.artifactTypeId, artifactTypeConfig.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(knowledgeArtifacts.createdAt));
}
