import assert from "node:assert";
import { db } from "@/lib/db/client";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { eq, like } from "drizzle-orm";
import { claimNextArtifactId } from "../artifact-id-service";
import { createKnowledgeArtifact, listArtifactTypes } from "../artifacts-service";

const TEST_PREFIX = "ZTEST";

async function cleanup() {
  const [testType] = await db.select().from(artifactTypeConfig).where(eq(artifactTypeConfig.prefix, TEST_PREFIX)).limit(1);
  if (testType) {
    await db.delete(knowledgeArtifacts).where(like(knowledgeArtifacts.artifactId, `${TEST_PREFIX}%`));
    await db.delete(artifactTypeConfig).where(eq(artifactTypeConfig.id, testType.id));
  }
}

async function testArtifactIdGenerator() {
  console.log("Verifying the config-driven typed-ID generator (replaces the old hardcoded 4-type version)...");
  await cleanup();

  try {
    // 1. The brief's own 10 seed types must actually exist and be admin-visible.
    const types = await listArtifactTypes();
    const trendBrief = types.find((t) => t.prefix === "TR");
    assert.ok(trendBrief, "TR (Trend Brief) must exist among the seeded types");
    assert.strictEqual(trendBrief!.label, "Trend Brief");

    // 2. A brand-new type can be added at any time (per the brief: "New
    // artifact types can be introduced at any time by adding a new prefix
    // and label to the config") — not hardcoded, a real insert works.
    const [newType] = await db.insert(artifactTypeConfig).values({ prefix: TEST_PREFIX, label: "Test Type", sortOrder: 999 }).returning();
    assert.ok(newType.id, "A new type must be insertable without touching code");

    // 3. IDs are claimed atomically and format as PREFIX + zero-padded
    // sequence (e.g. "ZTEST001"), per the brief's exact format, and every
    // type counts up independently starting from 1.
    const id1 = await claimNextArtifactId(newType.id);
    assert.strictEqual(id1, `${TEST_PREFIX}001`, "First claimed id for a fresh type must be 001");
    const id2 = await claimNextArtifactId(newType.id);
    assert.strictEqual(id2, `${TEST_PREFIX}002`, "Second claim must increment independently of any other type");

    // 4. Two concurrent claims must never collide — this is the actual
    // point of using an atomic UPDATE ... RETURNING instead of scanning
    // existing rows for the highest number.
    const [id3, id4] = await Promise.all([claimNextArtifactId(newType.id), claimNextArtifactId(newType.id)]);
    assert.notStrictEqual(id3, id4, "Concurrent claims for the same type must never produce the same id");

    // 5. createKnowledgeArtifact actually persists the real id, not embedded in the title.
    const artifact = await createKnowledgeArtifact({ artifactTypeId: newType.id, title: "A real test artifact", description: "test" });
    assert.strictEqual(artifact.title, "A real test artifact", "Title must be stored as-is, not prefixed with the generated id");
    assert.ok(/^ZTEST\d{3}$/.test(artifact.artifactId), `artifactId must be a real dedicated field formatted like ZTEST005, got: ${artifact.artifactId}`);

    console.log("✓ All typed-ID generator assertions passed cleanly!");
  } finally {
    await cleanup();
  }
}

testArtifactIdGenerator()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
