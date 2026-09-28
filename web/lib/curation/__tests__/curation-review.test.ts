import assert from "node:assert";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { curationItemIdeas } from "@/lib/db/schema/curation_item_ideas";
import { curationIdeaVersions } from "@/lib/db/schema/curation_idea_versions";
import { eq, inArray } from "drizzle-orm";
import { submitCurationItemIdea } from "../curation-service";
import { sendCurationBack, getCurationReview } from "../curation-review";
import { discardDraft, listActiveDrafts } from "../draft-service";
import { curationReviewAppliesTo, getCurationReviewMode, setCurationReviewMode } from "@/lib/settings/app-settings";
import { getKanbanBoardData, updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import { CURATED_STATUS } from "@/lib/kanban/move-rules";

const CURATOR_EMAIL = "test-curation-review-curator@example.com";
const OPERATOR_EMAIL = "test-curation-review-operator@example.com";
const assetIds: string[] = [];
const ideaIds: string[] = [];
let curatorId = "";
let operatorId = "";

async function cleanup() {
  if (assetIds.length > 0) await db.delete(auditLog).where(inArray(auditLog.entityId, assetIds));
  const people = await db.select({ id: personnel.id }).from(personnel).where(inArray(personnel.email, [CURATOR_EMAIL, OPERATOR_EMAIL]));
  if (people.length > 0) await db.delete(auditLog).where(inArray(auditLog.actorId, people.map((p) => p.id)));
  if (ideaIds.length > 0) {
    await db.delete(curationIdeaVersions).where(inArray(curationIdeaVersions.ideaId, ideaIds));
    await db.delete(curationItemIdeas).where(inArray(curationItemIdeas.id, ideaIds));
  }
  // Status history and queued emails go with the asset (both cascade).
  if (assetIds.length > 0) await db.delete(assets).where(inArray(assets.id, assetIds));
  await db.delete(personnel).where(inArray(personnel.email, [CURATOR_EMAIL, OPERATOR_EMAIL]));
  assetIds.length = 0;
  ideaIds.length = 0;
}

async function testModesAndBoardVisibility() {
  console.log("Verifying the switch: off by default, and who each mode covers...");
  assert.strictEqual(curationReviewAppliesTo("off", ["admin"]), false);
  assert.strictEqual(curationReviewAppliesTo("admins", ["admin"]), true);
  assert.strictEqual(curationReviewAppliesTo("admins", ["operator"]), false);
  assert.strictEqual(curationReviewAppliesTo("everyone", ["curator"]), true);

  await setCurationReviewMode("everyone");
  assert.strictEqual(await getCurationReviewMode(), "everyone");
}

async function testReviewCycle() {
  console.log("Verifying a curated idea waits in Curated, is sent back, comes back with the same SKU, and is approved...");
  const submitted = await submitCurationItemIdea({
    ideaTitle: "Review Cycle Test Hat",
    category: "Hat",
    moodboardUrls: ["https://drive.google.com/file/d/testfileid1234567/view"],
    fieldValues: { pinterestBoard: "https://pinterest.com/test/board", whyItWillSell: "Holiday demand" },
    submitterId: curatorId,
    reviewFirst: true,
  });
  assetIds.push(submitted.asset.id);
  ideaIds.push(submitted.idea.id);
  const sku = submitted.sku;
  assert.strictEqual(submitted.currentStatus, CURATED_STATUS);
  assert.strictEqual(submitted.idea.status, "in_review");
  assert.strictEqual(submitted.asset.feeAmount, null, "The review form leaves the fee to the team");

  // Only a board that asks for the Curated column shows it, and a hidden card never falls into Unassigned.
  const shown = await getKanbanBoardData(undefined, { showCurated: true });
  assert.ok(shown.columns.find((c) => c.key === CURATED_STATUS)?.assets.some((a) => a.sku === sku));
  const hidden = await getKanbanBoardData();
  assert.ok(!hidden.columns.some((c) => c.key === CURATED_STATUS));
  assert.ok(!hidden.columns.some((c) => c.assets.some((a) => a.sku === sku)), "A hidden curated card must not show in another column");

  // The drawer shows the curator's fields by their labels.
  const review = await getCurationReview(sku);
  assert.ok(review?.fields.some((f) => f.label === "Pinterest board" && f.value === "https://pinterest.com/test/board"));

  // Sent back: the idea is a draft again, with the note and the SKU of its card.
  await sendCurationBack(sku, "Make the palette brighter", operatorId);
  const [drafted] = await listActiveDrafts(curatorId);
  assert.strictEqual(drafted?.id, submitted.idea.id);
  assert.strictEqual(drafted.reviewNote, "Make the palette brighter");
  assert.strictEqual(drafted.assetSku, sku);
  const afterSendBack = await getKanbanBoardData(undefined, { showCurated: true });
  const card = afterSendBack.columns.find((c) => c.key === CURATED_STATUS)?.assets.find((a) => a.sku === sku);
  assert.strictEqual(card?.curationSentBack, true);
  assert.strictEqual(card?.curatorId, curatorId);

  // A sent-back idea can't be discarded while its card is on the board.
  await assert.rejects(() => discardDraft(submitted.idea.id, curatorId), /still on the board/);

  // Sent again: same SKU, same card, back in review with the changes.
  const resubmitted = await submitCurationItemIdea({
    ideaTitle: "Review Cycle Test Hat, brighter",
    category: "Hat",
    moodboardUrls: ["https://drive.google.com/file/d/testfileid7654321/view"],
    fieldValues: { pinterestBoard: "https://pinterest.com/test/board" },
    submitterId: curatorId,
    draftId: submitted.idea.id,
    reviewFirst: true,
  });
  assert.strictEqual(resubmitted.sku, sku, "Sending it again must keep the SKU");
  assert.strictEqual(resubmitted.currentStatus, CURATED_STATUS);
  assert.strictEqual(resubmitted.idea.status, "in_review");
  assert.strictEqual(resubmitted.idea.reviewNote, null);
  assert.strictEqual(resubmitted.asset.itemName, "Review Cycle Test Hat, brighter");

  // Approved: the team moves it to Unassigned and the idea is marked approved.
  await updateAssetStatusInKanban(sku, "unassigned", { roles: ["operator"], personnelId: operatorId });
  const [approvedIdea] = await db.select().from(curationItemIdeas).where(eq(curationItemIdeas.id, submitted.idea.id));
  assert.strictEqual(approvedIdea.status, "approved");
  console.log("✓ The review cycle works end to end");
}

async function testSwitchingOff() {
  console.log("Verifying switching off moves waiting cards to Unassigned...");
  const waiting = await submitCurationItemIdea({ ideaTitle: "Switch Off Test Idea", submitterId: curatorId, reviewFirst: true });
  assetIds.push(waiting.asset.id);
  ideaIds.push(waiting.idea.id);

  const { movedToUnassigned } = await setCurationReviewMode("off");
  assert.ok(movedToUnassigned.includes(waiting.sku));
  const [asset] = await db.select().from(assets).where(eq(assets.id, waiting.asset.id));
  assert.strictEqual(asset.currentStatus, "unassigned");
  const [idea] = await db.select().from(curationItemIdeas).where(eq(curationItemIdeas.id, waiting.idea.id));
  assert.strictEqual(idea.status, "approved");

  // With the switch off, a new idea goes straight to Unassigned, as before the trial.
  const direct = await submitCurationItemIdea({ ideaTitle: "Switch Off Direct Idea", submitterId: curatorId });
  assetIds.push(direct.asset.id);
  ideaIds.push(direct.idea.id);
  assert.strictEqual(direct.currentStatus, "unassigned");
  console.log("✓ Switching off leaves nothing stranded in Curated");
}

async function main() {
  await cleanup();
  const [curator] = await db.insert(personnel).values({ name: "Review Curator", email: CURATOR_EMAIL, roles: ["curator"] }).returning();
  const [operator] = await db.insert(personnel).values({ name: "Review Operator", email: OPERATOR_EMAIL, roles: ["operator"] }).returning();
  curatorId = curator.id;
  operatorId = operator.id;

  await testModesAndBoardVisibility();
  await testReviewCycle();
  await testSwitchingOff();
}

main()
  .then(async () => {
    await setCurationReviewMode("off");
    await cleanup();
    console.log("✓ All curation review assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await setCurationReviewMode("off").catch(() => {});
    await cleanup().catch(() => {});
    process.exit(1);
  });
