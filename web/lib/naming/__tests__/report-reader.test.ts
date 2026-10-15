import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { nameEvidence } from "@/lib/db/schema/name_evidence";
import { docIdFrom, readLinkedReports, relevantLines, REPORT_READER, type DocReader } from "../report-reader";

const PREFIX = "TEST-REPORT-";
const DOC_ID = "1OryqV5EMRgYRNIVW569CED1_test_fixture";
// A report shaped like the tactical scans: one line per concept.
const REPORT = ["Controller General tactical orphan scan - Oct 7", "FAST: Phone Belt 93, Shoulder Strap 76", "", "Line about canteens", "tactical duty/battle belt with mounted smartphone", "Waist slot: belt with phone holder trending"].join("\n");

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(nameEvidence).where(inArray(nameEvidence.assetId, ids));
    await db.delete(artifactSkuLinks).where(inArray(artifactSkuLinks.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(knowledgeArtifacts).where(like(knowledgeArtifacts.artifactId, "TESTRPT%"));
}

async function test() {
  console.log("Verifying link parsing and line picking...");
  assert.strictEqual(docIdFrom(`https://docs.google.com/document/d/${DOC_ID}/edit?usp=drivesdk`), DOC_ID);
  assert.strictEqual(docIdFrom("https://in.pinterest.com/board/"), null);
  const lines = relevantLines(REPORT, ["tactical", "waist", "belt", "phone"]);
  assert.deepStrictEqual(lines.map((l) => l.line), [2, 5, 6], "Lines with the item's words, in document order, with 1-based numbers");
  assert.deepStrictEqual(relevantLines(REPORT, ["the", "tactical"]), [], "Words too common to find an item by are ignored");

  console.log("Verifying reports become evidence, once, and unreadable ones are reported...");
  await cleanup();
  const [type] = await db.select({ id: artifactTypeConfig.id }).from(artifactTypeConfig).limit(1);
  const [asset] = await db.insert(assets).values({ sku: `${PREFIX}BELT`, itemName: "tactical waist belt with phone", category: "Waist", currentStatus: "ready_for_upload" }).returning();
  const [doc] = await db.insert(knowledgeArtifacts).values({ artifactId: "TESTRPT1", artifactTypeId: type.id, title: "Scan", fileUrl: `https://docs.google.com/document/d/${DOC_ID}/edit` }).returning();
  const [board] = await db.insert(knowledgeArtifacts).values({ artifactId: "TESTRPT2", artifactTypeId: type.id, title: "Moodboard", fileUrl: "https://in.pinterest.com/board/" }).returning();
  const [locked] = await db.insert(knowledgeArtifacts).values({ artifactId: "TESTRPT3", artifactTypeId: type.id, title: "Locked", fileUrl: "https://docs.google.com/document/d/1NotSharedWithKanban_fixture/edit" }).returning();
  await db.insert(artifactSkuLinks).values([doc, board, locked].map((a) => ({ artifactId: a.id, assetId: asset.id })));

  let reads = 0;
  const reader: DocReader = async (id) => {
    reads++;
    return id === DOC_ID ? { ok: true, text: REPORT } : { ok: false, reason: "not shared with the Kanban" };
  };
  const first = await readLinkedReports({ onlySkus: [asset.sku], statuses: ["ready_for_upload"], reader });
  assert.strictEqual(first.read, 1);
  assert.strictEqual(first.linesSaved, 3);
  assert.deepStrictEqual(first.skipped.map((s) => `${s.artifactId}: ${s.reason}`).sort(), ["TESTRPT2: link isn't a Google Doc or Drive file", "TESTRPT3: not shared with the Kanban"]);
  const saved = await db.select().from(nameEvidence).where(eq(nameEvidence.assetId, asset.id));
  assert.ok(saved.every((e) => e.kind === "report_line" && e.sourceRef === "TESTRPT1" && e.enteredBy === REPORT_READER));
  assert.ok(saved.some((e) => e.location === "line 5" && e.quote.includes("duty/battle belt")));
  const again = await readLinkedReports({ onlySkus: [asset.sku], statuses: ["ready_for_upload"], reader });
  assert.strictEqual(again.linesSaved, 0, "Re-reading saves nothing new");
  assert.strictEqual(reads, 4, "Each report is read once per run");
  console.log("Confirmed the report reader");
}

test()
  .then(async () => {
    await cleanup();
    console.log("✓ All report reader assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
