import { db } from "@/lib/db/client";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, asc, and, isNull, sql, type SQL } from "drizzle-orm";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { alias } from "drizzle-orm/pg-core";
import { claimNextArtifactId } from "./artifact-id-service";
import { TREND_BRIEF_PREFIX } from "./artifact-forms";

// Replaces the old hardcoded 4-type prefix map (tech_spec/mannequin_rig/
// recruiting_faq/style_guide) and the old ID format ("SPEC-0001", found by
// re-parsing existing titles for the highest number). Per the brief's §7:
// the prefix list is admin-configurable (artifact_type_config), IDs are a
// real dedicated column (not embedded in the title text), and the number
// is claimed atomically (see artifact-id-service.ts) rather than found by
// scanning. See HANDOFF.md for the full writeup of what was wrong before.

/**
 * The condition every Registry read adds: an artifact someone archived stays out of the Registry,
 * the board's registry chips, the asset drawer and the final-files checklist.
 */
export function activeArtifact(): SQL {
  return isNull(knowledgeArtifacts.archivedAt);
}

export async function listArtifactTypes() {
  return db.select().from(artifactTypeConfig).orderBy(asc(artifactTypeConfig.sortOrder));
}

/** One artifact type by its row id, or null when there is none. */
export async function findArtifactType(id: string) {
  const [type] = await db.select().from(artifactTypeConfig).where(eq(artifactTypeConfig.id, id)).limit(1);
  return type ?? null;
}

/** The trend link on a submission points to something that isn't a Trend Brief in the Registry. */
export class InvalidTrendLinkError extends Error {}

/** The artifact id matched nothing, or matched an artifact that is already archived. */
export class ArtifactNotFoundError extends Error {}

export interface CreateArtifactOptions {
  artifactTypeId: string;
  title: string;
  description?: string;
  source?: string;
  fileUrl?: string;
  tags?: string[];
  addedBy?: string;
  usageNotes?: string;
  /** The per-type fields with no column, keyed as lib/knowledge/artifact-forms.ts defines them. */
  details?: Record<string, unknown>;
  /** The Trend Brief this came from. */
  trendArtifactId?: string;
  actorId?: string;
}

// A trend link must point at a Trend Brief that is still in the Registry.
async function assertTrendBrief(trendArtifactId: string): Promise<void> {
  const [trend] = await db
    .select({ prefix: artifactTypeConfig.prefix })
    .from(knowledgeArtifacts)
    .innerJoin(artifactTypeConfig, eq(knowledgeArtifacts.artifactTypeId, artifactTypeConfig.id))
    .where(and(eq(knowledgeArtifacts.id, trendArtifactId), activeArtifact()))
    .limit(1);
  if (trend?.prefix !== TREND_BRIEF_PREFIX) throw new InvalidTrendLinkError("The trend must be a Trend Brief in the Registry");
}

export async function createKnowledgeArtifact(options: CreateArtifactOptions) {
  const { artifactTypeId, title, description, source, fileUrl, tags, addedBy, usageNotes, details, trendArtifactId, actorId } = options;

  if (trendArtifactId) await assertTrendBrief(trendArtifactId);

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
      details: details ?? {},
      trendArtifactId: trendArtifactId || null,
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

/**
 * Takes an artifact out of the Registry without deleting it, and logs who did it. Its ID stays
 * claimed and its links stay in the database.
 *
 * Input: the artifact's row id and the acting person's id. Output: the archived artifact's typed
 * id, e.g. "TEST001". Throws ArtifactNotFoundError when there is no such artifact in the Registry.
 */
export async function archiveKnowledgeArtifact(id: string, actorId: string | null): Promise<string> {
  return db.transaction(async (tx) => {
    const [archived] = await tx
      .update(knowledgeArtifacts)
      .set({ archivedAt: new Date(), archivedBy: actorId, updatedAt: new Date() })
      .where(and(eq(knowledgeArtifacts.id, id), activeArtifact()))
      .returning({ id: knowledgeArtifacts.id, artifactId: knowledgeArtifacts.artifactId, title: knowledgeArtifacts.title });
    if (!archived) throw new ArtifactNotFoundError(`No artifact ${id} in the Registry`);
    await tx.insert(auditLog).values({
      action: "archiveKnowledgeArtifact",
      entityType: "knowledge_artifact",
      entityId: archived.id,
      actorId,
      payload: { artifactId: archived.artifactId, title: archived.title },
    });
    return archived.artifactId;
  });
}

/** Every artifact in the Registry (archived ones left out), oldest first, optionally of one type. */
export async function getKnowledgeArtifacts(artifactTypeId?: string) {
  const conditions: SQL[] = [activeArtifact()];
  if (artifactTypeId) conditions.push(eq(knowledgeArtifacts.artifactTypeId, artifactTypeId));
  const trend = alias(knowledgeArtifacts, "trend");

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
      details: knowledgeArtifacts.details,
      trendArtifactId: knowledgeArtifacts.trendArtifactId,
      trendCode: trend.artifactId,
      trendTitle: trend.title,
      addedByName: personnel.name,
      createdAt: knowledgeArtifacts.createdAt,
      typeLabel: artifactTypeConfig.label,
      typePrefix: artifactTypeConfig.prefix,
      // When it was last linked to an asset, for "recently used" in the New Asset picker. Null if never.
      lastLinkedAt: sql<string | null>`(select max(${artifactSkuLinks.createdAt}) from ${artifactSkuLinks} where ${artifactSkuLinks.artifactId} = ${knowledgeArtifacts.id})`,
    })
    .from(knowledgeArtifacts)
    .innerJoin(artifactTypeConfig, eq(knowledgeArtifacts.artifactTypeId, artifactTypeConfig.id))
    .leftJoin(trend, and(eq(trend.id, knowledgeArtifacts.trendArtifactId), isNull(trend.archivedAt)))
    .leftJoin(personnel, eq(personnel.id, knowledgeArtifacts.addedBy))
    .where(and(...conditions))
    .orderBy(asc(knowledgeArtifacts.createdAt));
}
