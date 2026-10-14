import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { appSettings } from "@/lib/db/schema/app_settings";
import { auditLog } from "@/lib/db/schema/audit_log";
import { nameEvidence } from "@/lib/db/schema/name_evidence";
import { nameProposals } from "@/lib/db/schema/name_proposals";
import { personnel } from "@/lib/db/schema/personnel";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { getReadyForUploadQueue } from "@/lib/publisher/publisher-service";
import { MARKETING_TASK_ID, proposeDraft } from "@/lib/marketing/nomination-service";
import { approveName, driveFileIds, groupKeyOf, listNaming, NamingError, runNaming, setGuidelines, type NamingCaller } from "../naming-service";

const PREFIX = "TEST-NAME-";
const OWNER_EMAIL = "test-naming-owner@example.test";
// A 1x1 PNG, standing in for a concept image.
const PIXEL = { mediaType: "image/png" as const, base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" };

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(nameEvidence).where(inArray(nameEvidence.assetId, ids));
    await db.delete(nameProposals).where(inArray(nameProposals.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(auditLog).where(eq(auditLog.entityType, "naming"));
  await db.delete(appSettings).where(eq(appSettings.key, "naming_guidelines"));
  await db.delete(teamTaskComments).where(eq(teamTaskComments.taskId, MARKETING_TASK_ID));
  await db.delete(teamTasks).where(eq(teamTasks.id, MARKETING_TASK_ID));
  await db.delete(personnel).where(eq(personnel.email, OWNER_EMAIL));
}

// Answers like Claude would, from what each item's images "show".
function fakeCaller(calls: { groupKey: string; skus: string[]; images: number; quotes?: string[] }[]): NamingCaller {
  return async ({ groupKey, items }) => {
    calls.push({ groupKey, skus: items.map((i) => i.sku), images: items.reduce((n, i) => n + i.images.length, 0), quotes: items.flatMap((i) => (i.evidenceQuotes ?? []).map((e) => e.quote)) });
    return {
      refusal: null,
      usage: { input_tokens: 1000, output_tokens: 200 },
      result: {
        items: items.map((i) => ({
          sku: i.sku,
          image_notes: i.sku.endsWith("HAT") ? "A red Santa hat with reindeer antlers and a white pom-pom" : "A festive layered necklace with bell and candy cane charms",
          candidates: i.sku.endsWith("HAT")
            ? [
                { name: "Santa Reindeer Antler Hat", why: "Motifs from the images", words: [{ word: "Santa", source: "images" }] },
                { name: "Sparkly Glitter Santa Hat", why: "Adds sparkle", words: [{ word: "Sparkly", source: "images" }] },
                { name: "hat 1", why: "placeholder", words: [] },
                { name: "A".repeat(60), why: "too long", words: [] },
              ]
            : [{ name: "Christmas Candy Cane Bell Necklace", why: "Charms from the images", words: [{ word: "Christmas", source: "trend" }] }],
        })),
      },
    };
  };
}

async function test() {
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Naming Owner", email: OWNER_EMAIL, roles: ["admin"] }).returning();
  await db.insert(teamTasks).values({ id: MARKETING_TASK_ID, title: "Marketing company function", area: "marketing", ownerId: owner.id, isPrivate: true });
  const img = (id: string) => [{ provider: "google_drive", externalId: `https://drive.google.com/file/d/${id}/view`, sizeBytes: 10, mimeType: "image/png" }];
  await db.insert(assets).values([
    { sku: `${PREFIX}HAT`, itemName: "Reindeer hat", category: "Hat", currentStatus: "ready_for_upload", referenceImages: img("img-hat-fixture-id") },
    { sku: `${PREFIX}NECK`, itemName: "christmas necklace", category: "Neck", currentStatus: "ready_for_upload", referenceImages: img("img-neck-fixture-id"), briefFields: { trendReasoning: "Christmas charm necklaces trend" } },
    { sku: `${PREFIX}DONE`, itemName: "already named", currentStatus: "ready_for_upload", approvedName: "Already Named Hat" },
    { sku: `${PREFIX}LIVE`, itemName: "live item", currentStatus: "uploaded_to_roblox" },
  ]);

  console.log("Verifying Drive links and bare ids both resolve to file ids...");
  assert.deepStrictEqual(driveFileIds([{ provider: "drive", externalId: "https://drive.google.com/file/d/110FA8IgXtefpGlLDECp9fjfaFl678pRP/view" }]), ["110FA8IgXtefpGlLDECp9fjfaFl678pRP"]);

  console.log("Verifying grouping and the missing-key guard...");
  assert.strictEqual(groupKeyOf({ artifacts: [] }), "none");
  assert.strictEqual(groupKeyOf({ artifacts: [{ artifactId: "MBD001", title: "", description: null, tags: [] }, { artifactId: "ANA007", title: "", description: null, tags: [] }] }), "ANA007,MBD001");
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(runNaming(), NamingError, "No key, no run");
  if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;

  console.log("Verifying one batched call, image evidence, and filtered candidates...");
  // Full-text evidence entered from the sheet reaches Claude with the item.
  const [hatForEvidence] = await db.select().from(assets).where(eq(assets.sku, `${PREFIX}HAT`));
  await db.insert(nameEvidence).values({ assetId: hatForEvidence.id, kind: "workbook_row", sourceRef: "hat-ranking", location: "row 12", quote: "santa antler hat", confidence: "high", enteredBy: "instinct", rowHash: "test-naming-evidence-row" });
  const calls: { groupKey: string; skus: string[]; images: number; quotes?: string[] }[] = [];
  const loadImage = async () => PIXEL;
  const first = await runNaming({ onlySkus: [`${PREFIX}HAT`, `${PREFIX}NECK`, `${PREFIX}DONE`, `${PREFIX}LIVE`], caller: fakeCaller(calls), loadImage, actorId: owner.id });
  assert.strictEqual(first.named, 3, "Items waiting to upload or live, without an approved base name, are named");
  assert.strictEqual(calls.length, 1, "Items with the same artifacts go in one call");
  assert.deepStrictEqual([...calls[0].skus].sort(), [`${PREFIX}HAT`, `${PREFIX}LIVE`, `${PREFIX}NECK`], "The already-named item is skipped");
  assert.strictEqual(calls[0].images, 2, "Concept images are sent");
  assert.deepStrictEqual(calls[0].quotes, ["santa antler hat"], "Evidence quotes are sent; nothing else yet");
  const reads = (await listNaming()).find((i) => i.sku === `${PREFIX}HAT`)!.reads;
  assert.deepStrictEqual(reads.evidence.map((e) => e.quote), ["santa antler hat"], "Claude's own image reading isn't fed back as evidence");
  assert.strictEqual(reads.imageCount, 1);
  const hat = (await listNaming()).find((i) => i.sku === `${PREFIX}HAT`)!;
  assert.deepStrictEqual(hat.proposal!.candidates.map((c) => c.name), ["Santa Reindeer Antler Hat", "Sparkly Glitter Santa Hat"], "Placeholder and over-long names are dropped");
  assert.deepStrictEqual(hat.proposal!.candidates[0].unsupported, [], "Every word is in the image reading");
  assert.deepStrictEqual(hat.proposal!.candidates[1].unsupported, ["sparkly", "glitter"], "Words not in any evidence are flagged");
  const [hatAsset] = await db.select().from(assets).where(eq(assets.sku, `${PREFIX}HAT`));
  const evidence = (await db.select().from(nameEvidence).where(eq(nameEvidence.assetId, hatAsset.id))).find((e) => e.enteredBy === "claude-sonnet-5-5")!;
  assert.ok(evidence.kind === "image_correspondence" && evidence.confidence === "medium" && evidence.enteredBy === "claude-sonnet-5-5", "The image reading is saved as AI evidence");
  assert.strictEqual((await db.select().from(teamTaskComments).where(eq(teamTaskComments.taskId, MARKETING_TASK_ID))).length, 1, "One update asks Arjun to pick names");

  console.log("Verifying unchanged inputs aren't sent again, and changed guidelines are...");
  const again = await runNaming({ onlySkus: [`${PREFIX}HAT`, `${PREFIX}NECK`], caller: fakeCaller(calls), loadImage });
  assert.ok(again.named === 0 && again.skipped === 2 && calls.length === 1, "No second call for the same inputs");
  await setGuidelines("Use Title Case. No colours.", owner.id);
  await runNaming({ onlySkus: [`${PREFIX}HAT`], caller: fakeCaller(calls), loadImage });
  assert.strictEqual(calls.length, 2, "New guidelines mean new suggestions");
  const hatRows = await db.select().from(nameProposals).where(eq(nameProposals.assetId, hatAsset.id));
  assert.deepStrictEqual(hatRows.map((r) => r.status).sort(), ["pending", "superseded"], "The older suggestions are superseded");

  console.log("Verifying approval rules, the uploader view and Today's Picks prefill...");
  const latest = (await listNaming()).find((i) => i.sku === `${PREFIX}HAT`)!.proposal!;
  await assert.rejects(approveName(`${PREFIX}HAT`, { proposalId: latest.id, name: "Sparkly Glitter Santa Hat" }, owner.id), /Not in any evidence for this item: sparkly, glitter/);
  await assert.rejects(approveName(`${PREFIX}HAT`, { proposalId: latest.id, name: "hat 2" }, owner.id), /placeholder/);
  await assert.rejects(approveName(`${PREFIX}HAT`, { proposalId: hatRows.find((r) => r.status === "superseded")!.id, name: "Santa Reindeer Antler Hat" }, owner.id), /isn't this item's latest/);
  await approveName(`${PREFIX}HAT`, { proposalId: latest.id, name: "Santa Reindeer Antler Hat" }, owner.id);
  const queue = await getReadyForUploadQueue();
  assert.strictEqual(queue.find((q) => q.sku === `${PREFIX}HAT`)?.approvedName, "Santa Reindeer Antler Hat", "The uploader sees the approved name");
  const draft = proposeDraft({ sku: "X", itemName: "x", status: "uploaded_to_roblox", brandGroup: null, artifacts: [], trendReasoning: null, nameEvidence: [], approvedName: "Santa Reindeer Antler Hat", referenceImageCount: 0, listings: [], blockers: [] });
  assert.strictEqual(draft.proposed.final_name, "Santa Reindeer Antler Hat", "Today's Picks starts from the approved name");
  const [approvedRow] = await db.select().from(nameProposals).where(eq(nameProposals.id, latest.id));
  assert.ok(approvedRow.status === "approved" && approvedRow.chosenName === "Santa Reindeer Antler Hat");

  console.log("Verifying a failed call is recorded, not lost...");
  const failing: NamingCaller = async () => ({ result: null, refusal: "Declined", usage: {} });
  // A fresh item fails once (e.g. a bad API key), then the retry with the same inputs succeeds.
  await db.insert(assets).values({ sku: `${PREFIX}RETRY`, itemName: "retry hat", category: "Hat", currentStatus: "ready_for_upload", referenceImages: img("img-retry-fixture-id") });
  const failed = await runNaming({ onlySkus: [`${PREFIX}RETRY`], caller: failing, loadImage });
  assert.strictEqual(failed.failed, 1);
  assert.strictEqual((await listNaming()).find((i) => i.sku === `${PREFIX}RETRY`)!.proposal!.status, "failed");
  const retried = await runNaming({ onlySkus: [`${PREFIX}RETRY`], caller: fakeCaller(calls), loadImage });
  assert.strictEqual(retried.named, 1, "A failed attempt doesn't block a retry");
  const retry = (await listNaming()).find((i) => i.sku === `${PREFIX}RETRY`)!.proposal!;
  assert.ok(retry.status === "pending" && retry.error === null && retry.candidates.length > 0);
  console.log("Confirmed AI naming");
}

test()
  .then(async () => {
    await cleanup();
    console.log("✓ All naming assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
