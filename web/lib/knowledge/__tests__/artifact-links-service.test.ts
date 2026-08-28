import assert from "node:assert";
import {
  linkArtifactToSku,
  unlinkArtifactFromSku,
  linkArtifactToCategory,
  unlinkArtifactFromCategory,
  linkArtifactToGuideline,
  unlinkArtifactFromGuideline,
  linkArtifactToStyleSystem,
  unlinkArtifactFromStyleSystem,
  linkArtifactToCampaign,
  unlinkArtifactFromCampaign,
  linkArtifactToAssignment,
  unlinkArtifactFromAssignment,
  getLinksForArtifact,
  getArtifactsForAsset,
} from "../artifact-links-service";
import { createKnowledgeArtifact } from "../artifacts-service";
import { createStyleSystem } from "../style-systems-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { assignments } from "@/lib/db/schema/assignments";
import { guidelines } from "@/lib/db/schema/guidelines";
import { styleSystems } from "@/lib/db/schema/style_systems";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { artifactCategoryLinks } from "@/lib/db/schema/artifact_category_links";
import { artifactGuidelineLinks } from "@/lib/db/schema/artifact_guideline_links";
import { artifactStyleSystemLinks } from "@/lib/db/schema/artifact_style_system_links";
import { artifactCampaignLinks } from "@/lib/db/schema/artifact_campaign_links";
import { artifactAssignmentLinks } from "@/lib/db/schema/artifact_assignment_links";
import { eq } from "drizzle-orm";

const TEST_SKU = "TEST-ARTIFACT-LINKS-SKU";
const ARTIST_EMAIL = "test-artifact-links-artist@example.com";
const STYLE_NAME = "Test Y2K Aesthetic Pack";
const CAMPAIGN_NAME = "Test Summer Drop Campaign";

let assetId = "";
let artistId = "";
let assignmentId = "";
let guidelineId = "";
let styleSystemId = "";
let artifactId = "";

async function cleanup() {
  if (artifactId) {
    await db.delete(artifactSkuLinks).where(eq(artifactSkuLinks.artifactId, artifactId));
    await db.delete(artifactCategoryLinks).where(eq(artifactCategoryLinks.artifactId, artifactId));
    await db.delete(artifactGuidelineLinks).where(eq(artifactGuidelineLinks.artifactId, artifactId));
    await db.delete(artifactStyleSystemLinks).where(eq(artifactStyleSystemLinks.artifactId, artifactId));
    await db.delete(artifactCampaignLinks).where(eq(artifactCampaignLinks.artifactId, artifactId));
    await db.delete(artifactAssignmentLinks).where(eq(artifactAssignmentLinks.artifactId, artifactId));
    await db.delete(knowledgeArtifacts).where(eq(knowledgeArtifacts.id, artifactId));
  }
  if (assignmentId) await db.delete(assignments).where(eq(assignments.id, assignmentId));
  if (assetId) await db.delete(assets).where(eq(assets.id, assetId));
  if (guidelineId) await db.delete(guidelines).where(eq(guidelines.id, guidelineId));
  if (styleSystemId) await db.delete(styleSystems).where(eq(styleSystems.id, styleSystemId));
  await db.delete(personnel).where(eq(personnel.email, ARTIST_EMAIL));
}

// The brief's §7 names 6 "attachable to" surfaces. Before this round, 3 of
// them (artist briefs, style systems, marketing campaigns) didn't exist as
// linkable concepts at all, and of the other 3, only category had ever
// actually been called from real code - linkArtifactToSku and
// linkArtifactToGuideline existed but were completely orphaned. This walks
// all 6, for real, against the live DB: link, confirm it shows up in the
// aggregate getLinksForArtifact read, unlink, confirm it's gone. Also
// confirms getArtifactsForAsset (the reverse lookup AssetDrawer now calls)
// actually returns what was just linked.
async function testAllSixLinkSurfaces() {
  console.log("Verifying all 6 of the brief's §7 artifact link surfaces, live...");
  await cleanup();

  const [artist] = await db.insert(personnel).values({ name: "Test Artifact Links Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  artistId = artist.id;
  const [asset] = await db.insert(assets).values({ sku: TEST_SKU, itemName: "Test Artifact Links Asset", currentStatus: "unassigned" }).returning();
  assetId = asset.id;
  const [assignment] = await db.insert(assignments).values({ assetId, artistId, feeAmount: "100.00" }).returning();
  assignmentId = assignment.id;
  const [guideline] = await db
    .insert(guidelines)
    .values({ title: "Test Rigging Guideline", guidelineType: "general", contentMarkdown: "" })
    .returning();
  guidelineId = guideline.id;

  const [type] = await db.select().from(artifactTypeConfig).limit(1);
  assert.ok(type, "At least one seeded artifact type must exist to run this test");
  const artifact = await createKnowledgeArtifact({ artifactTypeId: type.id, title: "Test Linkable Artifact" });
  artifactId = artifact.id;

  const styleSystem = await createStyleSystem(STYLE_NAME, "A test aesthetic definition");
  styleSystemId = styleSystem.id;

  try {
    // Link all 6.
    await linkArtifactToSku(artifactId, assetId);
    await linkArtifactToCategory(artifactId, "Test Category");
    await linkArtifactToGuideline(artifactId, guidelineId);
    await linkArtifactToStyleSystem(artifactId, styleSystemId);
    await linkArtifactToCampaign(artifactId, CAMPAIGN_NAME);
    await linkArtifactToAssignment(artifactId, assignmentId);

    const links = await getLinksForArtifact(artifactId);
    assert.strictEqual(links.skus.length, 1, "SKU link must be real, not orphaned");
    assert.strictEqual(links.skus[0].sku, TEST_SKU);
    assert.strictEqual(links.categories.length, 1);
    assert.strictEqual(links.categories[0].category, "Test Category");
    assert.strictEqual(links.guidelines.length, 1, "Guideline link must be real, not orphaned");
    assert.strictEqual(links.guidelines[0].title, "Test Rigging Guideline");
    assert.strictEqual(links.styleSystems.length, 1, "Style system link must exist - this surface didn't exist before this round");
    assert.strictEqual(links.styleSystems[0].name, STYLE_NAME);
    assert.strictEqual(links.campaigns.length, 1, "Campaign link must exist - this surface didn't exist before this round");
    assert.strictEqual(links.campaigns[0].campaignName, CAMPAIGN_NAME);
    assert.strictEqual(links.assignments.length, 1, "Assignment/brief link must exist - this surface didn't exist before this round");
    assert.strictEqual(links.assignments[0].artistName, "Test Artifact Links Artist");

    // Idempotency: linking the same pair twice must not duplicate.
    await linkArtifactToSku(artifactId, assetId);
    const linksAfterDupe = await getLinksForArtifact(artifactId);
    assert.strictEqual(linksAfterDupe.skus.length, 1, "Re-linking the same SKU must not create a duplicate link");

    // The reverse lookup AssetDrawer now actually calls.
    const artifactsForAsset = await getArtifactsForAsset(TEST_SKU);
    assert.strictEqual(artifactsForAsset.length, 1);
    assert.strictEqual(artifactsForAsset[0].id, artifactId);

    console.log("Confirmed all 6 link surfaces are real, linked, idempotent, and readable both directions");

    // Unlink all 6 and confirm each is actually gone.
    await unlinkArtifactFromSku(links.skus[0].linkId);
    await unlinkArtifactFromCategory(links.categories[0].linkId);
    await unlinkArtifactFromGuideline(links.guidelines[0].linkId);
    await unlinkArtifactFromStyleSystem(links.styleSystems[0].linkId);
    await unlinkArtifactFromCampaign(links.campaigns[0].linkId);
    await unlinkArtifactFromAssignment(links.assignments[0].linkId);

    const linksAfterUnlink = await getLinksForArtifact(artifactId);
    assert.strictEqual(linksAfterUnlink.skus.length, 0);
    assert.strictEqual(linksAfterUnlink.categories.length, 0);
    assert.strictEqual(linksAfterUnlink.guidelines.length, 0);
    assert.strictEqual(linksAfterUnlink.styleSystems.length, 0);
    assert.strictEqual(linksAfterUnlink.campaigns.length, 0);
    assert.strictEqual(linksAfterUnlink.assignments.length, 0);

    console.log("Confirmed unlinking each surface actually removes it");
  } finally {
    await cleanup();
  }

  console.log("✓ All 6 artifact link surfaces verified against the live DB");
}

async function main() {
  await testAllSixLinkSurfaces();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
