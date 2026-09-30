import assert from "node:assert";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import {
  archiveKnowledgeArtifact,
  ArtifactNotFoundError,
  createKnowledgeArtifact,
  getKnowledgeArtifacts,
  InvalidTrendLinkError,
} from "../artifacts-service";
import { getArtifactsForSku, linkArtifactToSku } from "../artifact-links-service";

const TITLE_PREFIX = "(TEST-REGISTRY-ARCHIVE)";
const SKU = "TEST-REGISTRY-ARCHIVE-SKU";
const ACTOR_EMAIL = "test-registry-archive@example.com";

async function typeId(prefix: string): Promise<string> {
  const [type] = await db.select({ id: artifactTypeConfig.id }).from(artifactTypeConfig).where(eq(artifactTypeConfig.prefix, prefix)).limit(1);
  assert.ok(type, `The seeded ${prefix} type must exist`);
  return type.id;
}

async function cleanup() {
  const testArtifacts = await db.select({ id: knowledgeArtifacts.id }).from(knowledgeArtifacts).where(like(knowledgeArtifacts.title, `${TITLE_PREFIX}%`));
  const ids = testArtifacts.map((a) => a.id);
  if (ids.length > 0) {
    await db.delete(artifactSkuLinks).where(inArray(artifactSkuLinks.artifactId, ids));
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    // Moodboards point at the trend; clear that before deleting either.
    await db.update(knowledgeArtifacts).set({ trendArtifactId: null }).where(inArray(knowledgeArtifacts.id, ids));
    await db.delete(knowledgeArtifacts).where(inArray(knowledgeArtifacts.id, ids));
  }
  await db.delete(assets).where(eq(assets.sku, SKU));
  await db.delete(personnel).where(eq(personnel.email, ACTOR_EMAIL));
}

async function testTrendLinkAndDetails() {
  console.log("Verifying a moodboard stores its trend link and details, and only a Trend Brief can be its trend...");
  await cleanup();
  const moodboardTypeId = await typeId("MBD");
  const trend = await createKnowledgeArtifact({ artifactTypeId: await typeId("TR"), title: `${TITLE_PREFIX} Christmas`, details: { season: "Nov to Dec" } });
  const board = await createKnowledgeArtifact({
    artifactTypeId: moodboardTypeId,
    title: `${TITLE_PREFIX} Santa hats board`,
    fileUrl: "https://pinterest.com/board",
    trendArtifactId: trend.id,
  });
  assert.strictEqual(board.trendArtifactId, trend.id);
  assert.deepStrictEqual(trend.details, { season: "Nov to Dec" }, "Details are stored as given");

  await assert.rejects(
    () => createKnowledgeArtifact({ artifactTypeId: moodboardTypeId, title: `${TITLE_PREFIX} bad`, trendArtifactId: board.id }),
    InvalidTrendLinkError,
    "A moodboard can't name another moodboard as its trend"
  );

  const listed = (await getKnowledgeArtifacts()).find((a) => a.id === board.id);
  assert.strictEqual(listed?.trendTitle, `${TITLE_PREFIX} Christmas`, "The Registry list carries the trend's title");
  console.log("Confirmed the trend link, details and trend check");
  return { trend, board };
}

async function testArchive(boardId: string) {
  console.log("Verifying archiving takes an artifact out of the Registry and the asset drawer, and is logged...");
  const [actor] = await db.insert(personnel).values({ name: "Registry Archiver", email: ACTOR_EMAIL, roles: ["curator"] }).returning();
  const [asset] = await db.insert(assets).values({ sku: SKU, itemName: "Registry Archive Hat" }).returning();
  await linkArtifactToSku(boardId, asset.id);
  assert.ok((await getArtifactsForSku(asset.id)).some((a) => a.id === boardId), "Linked before archiving");

  await archiveKnowledgeArtifact(boardId, actor.id);
  assert.ok(!(await getKnowledgeArtifacts()).some((a) => a.id === boardId), "An archived artifact leaves the Registry list");
  assert.ok(!(await getArtifactsForSku(asset.id)).some((a) => a.id === boardId), "An archived artifact leaves the asset's links");
  const [row] = await db.select().from(knowledgeArtifacts).where(eq(knowledgeArtifacts.id, boardId));
  assert.ok(row?.archivedAt, "The row is kept, with archivedAt set");

  const [log] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, "archiveKnowledgeArtifact"), eq(auditLog.entityId, boardId)));
  assert.strictEqual(log?.actorId, actor.id, "Archiving writes an audit_log row with the actor");

  await assert.rejects(() => archiveKnowledgeArtifact(boardId, actor.id), ArtifactNotFoundError, "Archiving twice is refused");
  console.log("Confirmed archiving hides the artifact, keeps the row and logs it");
}

async function run() {
  const { board } = await testTrendLinkAndDetails();
  await testArchive(board.id);
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All registry archive assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
