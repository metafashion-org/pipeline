import { db } from "@/lib/db/client";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { artifactCategoryLinks } from "@/lib/db/schema/artifact_category_links";
import { artifactGuidelineLinks } from "@/lib/db/schema/artifact_guideline_links";
import { artifactStyleSystemLinks } from "@/lib/db/schema/artifact_style_system_links";
import { artifactCampaignLinks } from "@/lib/db/schema/artifact_campaign_links";
import { artifactAssignmentLinks } from "@/lib/db/schema/artifact_assignment_links";
import { assets } from "@/lib/db/schema/assets";
import { assignments } from "@/lib/db/schema/assignments";
import { guidelines } from "@/lib/db/schema/guidelines";
import { styleSystems } from "@/lib/db/schema/style_systems";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, and } from "drizzle-orm";

// The brief's §7 names 6 "attachable to" surfaces. Before this round, only
// SKU/category/guideline had link TABLES at all (style systems, marketing
// campaigns, and artist briefs didn't exist as linkable concepts anywhere),
// and of those three, only category had any actual UI ever calling it -
// linkArtifactToSku/linkArtifactToGuideline existed but were never once
// called outside their own tests. Every function below now has a real
// route and real UI (see app/api/admin/knowledge/artifacts/[artifactId]/links
// and components/knowledge/ArtifactLinksDialog.tsx).

export async function linkArtifactToSku(artifactId: string, assetId: string, actorId?: string) {
  const existing = await db
    .select()
    .from(artifactSkuLinks)
    .where(and(eq(artifactSkuLinks.artifactId, artifactId), eq(artifactSkuLinks.assetId, assetId)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [link] = await db.insert(artifactSkuLinks).values({ artifactId, assetId }).returning();

  await db.insert(auditLog).values({
    action: "linkArtifactToSku",
    entityType: "artifact_sku_link",
    entityId: link.id,
    actorId: actorId || null,
    payload: { artifactId, assetId },
  });

  return link;
}

export async function unlinkArtifactFromSku(linkId: string, actorId?: string) {
  const [link] = await db.select().from(artifactSkuLinks).where(eq(artifactSkuLinks.id, linkId)).limit(1);
  if (!link) throw new Error("Link not found");
  await db.delete(artifactSkuLinks).where(eq(artifactSkuLinks.id, linkId));
  await db.insert(auditLog).values({
    action: "unlinkArtifactFromSku",
    entityType: "artifact_sku_link",
    entityId: linkId,
    actorId: actorId || null,
    payload: { artifactId: link.artifactId, assetId: link.assetId },
  });
}

export async function linkArtifactToCategory(artifactId: string, category: string, actorId?: string) {
  const existing = await db
    .select()
    .from(artifactCategoryLinks)
    .where(and(eq(artifactCategoryLinks.artifactId, artifactId), eq(artifactCategoryLinks.category, category)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [link] = await db.insert(artifactCategoryLinks).values({ artifactId, category }).returning();

  await db.insert(auditLog).values({
    action: "linkArtifactToCategory",
    entityType: "artifact_category_link",
    entityId: link.id,
    actorId: actorId || null,
    payload: { artifactId, category },
  });

  return link;
}

export async function unlinkArtifactFromCategory(linkId: string, actorId?: string) {
  const [link] = await db.select().from(artifactCategoryLinks).where(eq(artifactCategoryLinks.id, linkId)).limit(1);
  if (!link) throw new Error("Link not found");
  await db.delete(artifactCategoryLinks).where(eq(artifactCategoryLinks.id, linkId));
  await db.insert(auditLog).values({
    action: "unlinkArtifactFromCategory",
    entityType: "artifact_category_link",
    entityId: linkId,
    actorId: actorId || null,
    payload: { artifactId: link.artifactId, category: link.category },
  });
}

export async function linkArtifactToGuideline(artifactId: string, guidelineId: string, actorId?: string) {
  const existing = await db
    .select()
    .from(artifactGuidelineLinks)
    .where(and(eq(artifactGuidelineLinks.artifactId, artifactId), eq(artifactGuidelineLinks.guidelineId, guidelineId)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [link] = await db.insert(artifactGuidelineLinks).values({ artifactId, guidelineId }).returning();

  await db.insert(auditLog).values({
    action: "linkArtifactToGuideline",
    entityType: "artifact_guideline_link",
    entityId: link.id,
    actorId: actorId || null,
    payload: { artifactId, guidelineId },
  });

  return link;
}

export async function unlinkArtifactFromGuideline(linkId: string, actorId?: string) {
  const [link] = await db.select().from(artifactGuidelineLinks).where(eq(artifactGuidelineLinks.id, linkId)).limit(1);
  if (!link) throw new Error("Link not found");
  await db.delete(artifactGuidelineLinks).where(eq(artifactGuidelineLinks.id, linkId));
  await db.insert(auditLog).values({
    action: "unlinkArtifactFromGuideline",
    entityType: "artifact_guideline_link",
    entityId: linkId,
    actorId: actorId || null,
    payload: { artifactId: link.artifactId, guidelineId: link.guidelineId },
  });
}

export async function linkArtifactToStyleSystem(artifactId: string, styleSystemId: string, actorId?: string) {
  const existing = await db
    .select()
    .from(artifactStyleSystemLinks)
    .where(and(eq(artifactStyleSystemLinks.artifactId, artifactId), eq(artifactStyleSystemLinks.styleSystemId, styleSystemId)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [link] = await db.insert(artifactStyleSystemLinks).values({ artifactId, styleSystemId }).returning();

  await db.insert(auditLog).values({
    action: "linkArtifactToStyleSystem",
    entityType: "artifact_style_system_link",
    entityId: link.id,
    actorId: actorId || null,
    payload: { artifactId, styleSystemId },
  });

  return link;
}

export async function unlinkArtifactFromStyleSystem(linkId: string, actorId?: string) {
  const [link] = await db.select().from(artifactStyleSystemLinks).where(eq(artifactStyleSystemLinks.id, linkId)).limit(1);
  if (!link) throw new Error("Link not found");
  await db.delete(artifactStyleSystemLinks).where(eq(artifactStyleSystemLinks.id, linkId));
  await db.insert(auditLog).values({
    action: "unlinkArtifactFromStyleSystem",
    entityType: "artifact_style_system_link",
    entityId: linkId,
    actorId: actorId || null,
    payload: { artifactId: link.artifactId, styleSystemId: link.styleSystemId },
  });
}

export async function linkArtifactToCampaign(artifactId: string, campaignName: string, actorId?: string) {
  const existing = await db
    .select()
    .from(artifactCampaignLinks)
    .where(and(eq(artifactCampaignLinks.artifactId, artifactId), eq(artifactCampaignLinks.campaignName, campaignName)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [link] = await db.insert(artifactCampaignLinks).values({ artifactId, campaignName }).returning();

  await db.insert(auditLog).values({
    action: "linkArtifactToCampaign",
    entityType: "artifact_campaign_link",
    entityId: link.id,
    actorId: actorId || null,
    payload: { artifactId, campaignName },
  });

  return link;
}

export async function unlinkArtifactFromCampaign(linkId: string, actorId?: string) {
  const [link] = await db.select().from(artifactCampaignLinks).where(eq(artifactCampaignLinks.id, linkId)).limit(1);
  if (!link) throw new Error("Link not found");
  await db.delete(artifactCampaignLinks).where(eq(artifactCampaignLinks.id, linkId));
  await db.insert(auditLog).values({
    action: "unlinkArtifactFromCampaign",
    entityType: "artifact_campaign_link",
    entityId: linkId,
    actorId: actorId || null,
    payload: { artifactId: link.artifactId, campaignName: link.campaignName },
  });
}

export async function linkArtifactToAssignment(artifactId: string, assignmentId: string, actorId?: string) {
  const existing = await db
    .select()
    .from(artifactAssignmentLinks)
    .where(and(eq(artifactAssignmentLinks.artifactId, artifactId), eq(artifactAssignmentLinks.assignmentId, assignmentId)))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [link] = await db.insert(artifactAssignmentLinks).values({ artifactId, assignmentId }).returning();

  await db.insert(auditLog).values({
    action: "linkArtifactToAssignment",
    entityType: "artifact_assignment_link",
    entityId: link.id,
    actorId: actorId || null,
    payload: { artifactId, assignmentId },
  });

  return link;
}

export async function unlinkArtifactFromAssignment(linkId: string, actorId?: string) {
  const [link] = await db.select().from(artifactAssignmentLinks).where(eq(artifactAssignmentLinks.id, linkId)).limit(1);
  if (!link) throw new Error("Link not found");
  await db.delete(artifactAssignmentLinks).where(eq(artifactAssignmentLinks.id, linkId));
  await db.insert(auditLog).values({
    action: "unlinkArtifactFromAssignment",
    entityType: "artifact_assignment_link",
    entityId: linkId,
    actorId: actorId || null,
    payload: { artifactId: link.artifactId, assignmentId: link.assignmentId },
  });
}

// One aggregate read for "everything this artifact is linked to" - what the
// Knowledge Registry's Links dialog renders, and the one place all 6
// surfaces are visible together instead of scattered across 6 separate
// queries a caller would have to know to make.
export interface ArtifactLinks {
  skus: { linkId: string; assetId: string; sku: string; itemName: string }[];
  categories: { linkId: string; category: string }[];
  guidelines: { linkId: string; guidelineId: string; title: string }[];
  styleSystems: { linkId: string; styleSystemId: string; name: string }[];
  campaigns: { linkId: string; campaignName: string }[];
  assignments: { linkId: string; assignmentId: string; sku: string; artistName: string | null }[];
}

export async function getLinksForArtifact(artifactId: string): Promise<ArtifactLinks> {
  const [skuRows, categoryRows, guidelineRows, styleRows, campaignRows, assignmentRows] = await Promise.all([
    db
      .select({ linkId: artifactSkuLinks.id, assetId: assets.id, sku: assets.sku, itemName: assets.itemName })
      .from(artifactSkuLinks)
      .innerJoin(assets, eq(artifactSkuLinks.assetId, assets.id))
      .where(eq(artifactSkuLinks.artifactId, artifactId)),
    db
      .select({ linkId: artifactCategoryLinks.id, category: artifactCategoryLinks.category })
      .from(artifactCategoryLinks)
      .where(eq(artifactCategoryLinks.artifactId, artifactId)),
    db
      .select({ linkId: artifactGuidelineLinks.id, guidelineId: guidelines.id, title: guidelines.title })
      .from(artifactGuidelineLinks)
      .innerJoin(guidelines, eq(artifactGuidelineLinks.guidelineId, guidelines.id))
      .where(eq(artifactGuidelineLinks.artifactId, artifactId)),
    db
      .select({ linkId: artifactStyleSystemLinks.id, styleSystemId: styleSystems.id, name: styleSystems.name })
      .from(artifactStyleSystemLinks)
      .innerJoin(styleSystems, eq(artifactStyleSystemLinks.styleSystemId, styleSystems.id))
      .where(eq(artifactStyleSystemLinks.artifactId, artifactId)),
    db
      .select({ linkId: artifactCampaignLinks.id, campaignName: artifactCampaignLinks.campaignName })
      .from(artifactCampaignLinks)
      .where(eq(artifactCampaignLinks.artifactId, artifactId)),
    db
      .select({ linkId: artifactAssignmentLinks.id, assignmentId: assignments.id, sku: assets.sku, artistName: personnel.name })
      .from(artifactAssignmentLinks)
      .innerJoin(assignments, eq(artifactAssignmentLinks.assignmentId, assignments.id))
      .innerJoin(assets, eq(assignments.assetId, assets.id))
      .leftJoin(personnel, eq(assignments.artistId, personnel.id))
      .where(eq(artifactAssignmentLinks.artifactId, artifactId)),
  ]);

  return { skus: skuRows, categories: categoryRows, guidelines: guidelineRows, styleSystems: styleRows, campaigns: campaignRows, assignments: assignmentRows };
}

export async function getArtifactsForSku(assetId: string) {
  return db
    .select({
      linkId: artifactSkuLinks.id,
      id: knowledgeArtifacts.id,
      artifactId: knowledgeArtifacts.artifactId, // the typed id, e.g. "TR001" — distinct from the row's uuid `id` above
      title: knowledgeArtifacts.title,
      typeLabel: artifactTypeConfig.label,
      fileUrl: knowledgeArtifacts.fileUrl,
      usageNotes: knowledgeArtifacts.usageNotes,
    })
    .from(artifactSkuLinks)
    .innerJoin(knowledgeArtifacts, eq(artifactSkuLinks.artifactId, knowledgeArtifacts.id))
    .innerJoin(artifactTypeConfig, eq(knowledgeArtifacts.artifactTypeId, artifactTypeConfig.id))
    .where(eq(artifactSkuLinks.assetId, assetId));
}

export async function getArtifactsForAsset(sku: string) {
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
  if (!asset) return [];
  return getArtifactsForSku(asset.id);
}
