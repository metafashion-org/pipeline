import assert from "node:assert";
import { db } from "@/lib/db/client";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactCategoryLinks } from "@/lib/db/schema/artifact_category_links";
import { assets } from "@/lib/db/schema/assets";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { eq } from "drizzle-orm";
import {
  seedArtifactSubmissionFormDefinition,
  processArtifactSubmission,
} from "../artifact-submission";
import { linkArtifactToSku, getArtifactsForSku } from "../artifact-links-service";

const TEST_SKU = "TEST-ARTIFACT-LINK-SKU";

async function testArtifactSubmissionAndLinking() {
  console.log("Verifying P3-T3/P3-T4: artifact submission via Forms engine + linking join tables...");

  const defId = await seedArtifactSubmissionFormDefinition();
  assert.ok(defId, "Form definition should be seeded/found");

  const [submission] = await db
    .insert(formSubmissions)
    .values({
      formDefinitionId: defId,
      submitterEmail: "test-curator@example.com",
      values: {
        artifactType: "tech_spec",
        title: "Test Submission",
        category: "streetwear-test",
        fileUrl: "https://example.com/spec.pdf",
        description: "A test artifact submission",
      },
      status: "pending",
    })
    .returning();

  try {
    // 1. Processing a submission creates a real knowledge_artifacts row with an auto-assigned ID
    const artifact = await processArtifactSubmission(submission.id);
    assert.ok(artifact.generatedId.startsWith("SPEC-"), "Generated ID should have the SPEC- prefix for tech_spec");

    const [reloadedSubmission] = await db.select().from(formSubmissions).where(eq(formSubmissions.id, submission.id)).limit(1);
    assert.strictEqual(reloadedSubmission.status, "approved", "Submission should be marked approved after processing");

    // 2. category from the submission auto-created an artifact_category_links row
    const categoryLinks = await db
      .select()
      .from(artifactCategoryLinks)
      .where(eq(artifactCategoryLinks.artifactId, artifact.id));
    assert.strictEqual(categoryLinks.length, 1, "Submission's category should have auto-linked");
    assert.strictEqual(categoryLinks[0].category, "streetwear-test");

    // 3. artifact_sku_links: an artifact can be linked to more than one SKU, and appears for each
    await db.delete(assets).where(eq(assets.sku, TEST_SKU));
    const [asset] = await db.insert(assets).values({ sku: TEST_SKU, itemName: "Link Test Asset" }).returning();

    await linkArtifactToSku(artifact.id, asset.id);
    await linkArtifactToSku(artifact.id, asset.id); // idempotent: second call should not duplicate

    const linksForAsset = await getArtifactsForSku(asset.id);
    assert.strictEqual(linksForAsset.length, 1, "Linking the same artifact+SKU twice should not duplicate");
    assert.strictEqual(linksForAsset[0].artifactId, artifact.id);

    // cleanup
    await db.delete(artifactSkuLinks).where(eq(artifactSkuLinks.assetId, asset.id));
    await db.delete(assets).where(eq(assets.sku, TEST_SKU));
    await db.delete(artifactCategoryLinks).where(eq(artifactCategoryLinks.artifactId, artifact.id));
    await db.delete(knowledgeArtifacts).where(eq(knowledgeArtifacts.id, artifact.id));
  } finally {
    await db.delete(formSubmissions).where(eq(formSubmissions.id, submission.id));
  }

  console.log("✓ All P3-T3/P3-T4 assertions passed cleanly against a live DB!");
}

testArtifactSubmissionAndLinking()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
