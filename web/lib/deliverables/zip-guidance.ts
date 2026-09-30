import { db } from "@/lib/db/client";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { artifactCategoryLinks } from "@/lib/db/schema/artifact_category_links";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { eq, inArray } from "drizzle-orm";
import { getBriefFieldsForAsset } from "@/lib/curation/curation-service";
import { parseDriveRefs } from "@/lib/assets/drive-links";

/** A Registry item linked to the asset or its category, such as motion pack guidelines. */
export interface ZipGuideline {
  artifactId: string;
  title: string;
  type: string;
  url: string | null;
}

/** What the Submit final files page lists as going in one asset's .zip, beyond the standard checklist. */
export interface ZipGuidance {
  recolourCount: number;
  /** Brief fields about how to make it, such as Rig and Technical Specs. */
  briefNotes: { label: string; value: string }[];
  guidelines: ZipGuideline[];
}

// Brief fields the checklist leaves out: the deadline and fee don't say what goes in the .zip, and
// the recolours are counted from the asset itself.
const FIELDS_NOT_IN_ZIP_GUIDANCE: ReadonlySet<string> = new Set(["deadline", "budget", "recolorDirections"]);

/**
 * Works out, for each asset, what its .zip needs beyond the standard checklist: one texture set per
 * recolour, what its brief says about rig and specs, and the Registry items linked to it or to its
 * category (for example motion pack guidelines).
 *
 * Input: the assets, with their category and recolour references. Output: guidance by asset id.
 */
export async function getZipGuidance(
  assetRows: { id: string; category: string | null; recolorReferenceImages: unknown }[]
): Promise<Map<string, ZipGuidance>> {
  const assetIds = assetRows.map((a) => a.id);
  const categories = Array.from(new Set(assetRows.map((a) => a.category).filter((c): c is string => Boolean(c))));
  const artifactColumns = {
    artifactId: knowledgeArtifacts.artifactId,
    title: knowledgeArtifacts.title,
    url: knowledgeArtifacts.fileUrl,
    type: artifactTypeConfig.label,
  };

  const [skuLinks, categoryLinks, briefs] = await Promise.all([
    assetIds.length > 0
      ? db
          .select({ assetId: artifactSkuLinks.assetId, ...artifactColumns })
          .from(artifactSkuLinks)
          .innerJoin(knowledgeArtifacts, eq(artifactSkuLinks.artifactId, knowledgeArtifacts.id))
          .innerJoin(artifactTypeConfig, eq(knowledgeArtifacts.artifactTypeId, artifactTypeConfig.id))
          .where(inArray(artifactSkuLinks.assetId, assetIds))
      : Promise.resolve([]),
    categories.length > 0
      ? db
          .select({ category: artifactCategoryLinks.category, ...artifactColumns })
          .from(artifactCategoryLinks)
          .innerJoin(knowledgeArtifacts, eq(artifactCategoryLinks.artifactId, knowledgeArtifacts.id))
          .innerJoin(artifactTypeConfig, eq(knowledgeArtifacts.artifactTypeId, artifactTypeConfig.id))
          .where(inArray(artifactCategoryLinks.category, categories))
      : Promise.resolve([]),
    Promise.all(assetRows.map((a) => getBriefFieldsForAsset(a.id))),
  ]);

  const guidance = new Map<string, ZipGuidance>();
  assetRows.forEach((asset, i) => {
    const linked = [...skuLinks.filter((l) => l.assetId === asset.id), ...categoryLinks.filter((l) => l.category === asset.category)];
    // An item linked both to the SKU and to its category is listed once.
    const guidelines = Array.from(new Map(linked.map((l) => [l.artifactId, { artifactId: l.artifactId, title: l.title, type: l.type, url: l.url }])).values());
    guidance.set(asset.id, {
      recolourCount: parseDriveRefs(asset.recolorReferenceImages).length,
      briefNotes: briefs[i].filter((f) => !FIELDS_NOT_IN_ZIP_GUIDANCE.has(f.key)).map((f) => ({ label: f.displayName, value: f.value })),
      guidelines,
    });
  });
  return guidance;
}
