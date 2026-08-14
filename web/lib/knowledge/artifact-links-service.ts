import { db } from "@/lib/db/client";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { artifactCategoryLinks } from "@/lib/db/schema/artifact_category_links";
import { artifactGuidelineLinks } from "@/lib/db/schema/artifact_guideline_links";
import { assets } from "@/lib/db/schema/assets";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, and } from "drizzle-orm";

export async function linkArtifactToSku(artifactId: string, assetId: string, actorId?: string) {
  const existing = await db
    .select()
    .from(artifactSkuLinks)
    .where(and(eq(artifactSkuLinks.artifactId, artifactId), eq(artifactSkuLinks.assetId, assetId)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [link] = await db
    .insert(artifactSkuLinks)
    .values({ artifactId, assetId })
    .returning();

  await db.insert(auditLog).values({
    action: "linkArtifactToSku",
    entityType: "artifact_sku_link",
    entityId: link.id,
    actorId: actorId || null,
    payload: { artifactId, assetId },
  });

  return link;
}

export async function linkArtifactToCategory(artifactId: string, category: string, actorId?: string) {
  const existing = await db
    .select()
    .from(artifactCategoryLinks)
    .where(and(eq(artifactCategoryLinks.artifactId, artifactId), eq(artifactCategoryLinks.category, category)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [link] = await db
    .insert(artifactCategoryLinks)
    .values({ artifactId, category })
    .returning();

  await db.insert(auditLog).values({
    action: "linkArtifactToCategory",
    entityType: "artifact_category_link",
    entityId: link.id,
    actorId: actorId || null,
    payload: { artifactId, category },
  });

  return link;
}

export async function linkArtifactToGuideline(artifactId: string, guidelineId: string, actorId?: string) {
  const existing = await db
    .select()
    .from(artifactGuidelineLinks)
    .where(and(eq(artifactGuidelineLinks.artifactId, artifactId), eq(artifactGuidelineLinks.guidelineId, guidelineId)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [link] = await db
    .insert(artifactGuidelineLinks)
    .values({ artifactId, guidelineId })
    .returning();

  await db.insert(auditLog).values({
    action: "linkArtifactToGuideline",
    entityType: "artifact_guideline_link",
    entityId: link.id,
    actorId: actorId || null,
    payload: { artifactId, guidelineId },
  });

  return link;
}

export async function getArtifactsForSku(assetId: string) {
  return db
    .select({
      linkId: artifactSkuLinks.id,
      artifactId: knowledgeArtifacts.id,
      title: knowledgeArtifacts.title,
      artifactType: knowledgeArtifacts.artifactType,
      fileUrl: knowledgeArtifacts.fileUrl,
    })
    .from(artifactSkuLinks)
    .innerJoin(knowledgeArtifacts, eq(artifactSkuLinks.artifactId, knowledgeArtifacts.id))
    .where(eq(artifactSkuLinks.assetId, assetId));
}

export async function getArtifactsForAsset(sku: string) {
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
  if (!asset) return [];
  return getArtifactsForSku(asset.id);
}
