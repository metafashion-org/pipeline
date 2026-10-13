import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { personnel } from "@/lib/db/schema/personnel";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { robloxListingChecks } from "@/lib/db/schema/roblox_listing_checks";
import { nominationDrafts, nominationEvents } from "@/lib/db/schema/nomination_drafts";
import { marketingSuggestions } from "@/lib/db/schema/marketing_suggestions";
import {
  confirmSubmitted,
  draftProblems,
  getNomination,
  ingestSuggestions,
  MARKETING_TASK_ID,
  proposeName,
  proposeTags,
  saveDraft,
  seasonFrom,
  startRenomination,
  undoSubmitted,
} from "../nomination-service";
import { listTodaysPicksPreview, TodaysPicksError, type PreviewItem, type PreviewListing } from "../todays-picks-service";

const SKU_PREFIX = "TEST-NOM-";
const SKU = `${SKU_PREFIX}PARASOL`;
const OWNER_EMAIL = "test-nom-owner@example.test";

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${SKU_PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(marketingSuggestions).where(inArray(marketingSuggestions.assetId, ids));
    await db.delete(nominationDrafts).where(inArray(nominationDrafts.assetId, ids));
    await db.delete(uploadRecords).where(inArray(uploadRecords.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(teamTaskComments).where(eq(teamTaskComments.taskId, MARKETING_TASK_ID));
  await db.delete(teamTasks).where(eq(teamTasks.id, MARKETING_TASK_ID));
  await db.delete(personnel).where(eq(personnel.email, OWNER_EMAIL));
}

function listing(id: string, assetId: string, overrides: Partial<PreviewListing> = {}): PreviewListing {
  return {
    id,
    url: `https://www.roblox.com/catalog/${assetId}`,
    robloxAssetId: assetId,
    variantLabel: null,
    onSaleAt: "2026-10-13T00:00:00Z",
    isMain: false,
    thumbnailUrl: null,
    lastCheck: { checkedAt: "2026-10-13T00:00:00Z", isForSale: true, priceRobux: 145, robloxName: "Red Christmas Bow Parasol", creatorName: "UGC Items", assetTypeId: 46, ourOnSale: true, error: null },
    ...overrides,
  };
}

function testProposals() {
  console.log("Verifying name, tag and season proposals and the form's rules...");
  const belt = proposeName("tactical waist belt with phone maroon / phone duo/ phone glacier");
  assert.ok(belt.length <= 49 && !/\bwith\b/i.test(belt) && !belt.includes("/"), `Name cleaned and cut: ${belt}`);
  assert.strictEqual(proposeName("Phone phone PHONE belt"), "Phone Belt", "Repeated words are dropped");
  assert.strictEqual(seasonFrom("christmas cute reindeer backpack"), "Christmas");
  assert.strictEqual(seasonFrom("tactical belt"), "");
  const tags = proposeTags("Christmas Bow Parasol", 46, ["cozy", "festive", "christmas"]);
  assert.ok(tags.length <= 80 && tags.includes("back accessory") && tags.split(", ").filter((t) => t === "christmas").length === 1, `Tags: ${tags}`);

  const item: PreviewItem = {
    sku: "X",
    itemName: "Bow Parasol",
    status: "uploaded_to_roblox",
    brandGroup: null,
    artifacts: [],
    trendReasoning: null,
    referenceImageCount: 0,
    blockers: [],
    listings: [listing("main", "111", { isMain: true }), listing("r1", "222"), listing("r2", "333")],
  };
  const good = {
    final_name: "Red Christmas Bow Parasol",
    item_link: "https://www.roblox.com/catalog/111/Red",
    item_type: "Accessory / Hair",
    tags: "christmas, parasol",
    colour_links: "https://www.roblox.com/catalog/222\nhttps://www.roblox.com/catalog/333",
  };
  assert.deepStrictEqual(draftProblems(good, item), [], "A complete, grounded draft has no problems");
  const expectProblem = (fields: Record<string, string>, text: string, it: PreviewItem = item) =>
    assert.ok(
      draftProblems({ ...good, ...fields }, it).some((p) => p.message.includes(text)),
      `Expected "${text}" in ${JSON.stringify(draftProblems({ ...good, ...fields }, it))}`
    );
  expectProblem({ final_name: "belt 1" }, "placeholder");
  expectProblem({ final_name: "A".repeat(50) }, "limit is 49");
  expectProblem({ tags: "" }, "Tags are required");
  expectProblem({ tags: "x".repeat(81) }, "limit is 80");
  expectProblem({ season: "x".repeat(21) }, "limit is 20");
  expectProblem({ item_type: "Hat" }, "Pick an item type");
  expectProblem({ audience: "Kids" }, "three choices");
  expectProblem({ item_link: "https://www.roblox.com/catalog/222" }, "isn't this SKU's main listing");
  expectProblem({ colour_links: "https://www.roblox.com/catalog/999" }, "isn't one of this SKU's listings");
  expectProblem({ colour_links: "https://www.roblox.com/catalog/222\nhttps://www.roblox.com/catalog/222" }, "listed twice");
  expectProblem({ colour_links: "https://www.roblox.com/catalog/111" }, "main listing can't also be");
  expectProblem({ final_name: "Christmas Bow Parasol" }, 'Rename the main listing on Roblox from "Red Christmas Bow Parasol"');
  expectProblem({}, "Choose a main listing", { ...item, listings: item.listings.map((l) => ({ ...l, isMain: false })) });
  console.log("Confirmed proposals and rules");
}

async function seed() {
  const [owner] = await db.insert(personnel).values({ name: "Nom Owner", email: OWNER_EMAIL, roles: ["admin"] }).returning();
  await db.insert(teamTasks).values({ id: MARKETING_TASK_ID, title: "Marketing company function", area: "marketing", ownerId: owner.id, isPrivate: true });
  const [asset] = await db.insert(assets).values({ sku: SKU, itemName: "christmas bow parasol", currentStatus: "uploaded_to_roblox" }).returning();
  const links = await db
    .insert(uploadRecords)
    .values([
      { assetId: asset.id, robloxAssetId: "7001", robloxItemUrl: "https://www.roblox.com/catalog/7001", onSaleAt: new Date(), mainAt: new Date() },
      { assetId: asset.id, robloxAssetId: "7002", robloxItemUrl: "https://www.roblox.com/catalog/7002", onSaleAt: new Date() },
      { assetId: asset.id, robloxAssetId: "7003", robloxItemUrl: "https://www.roblox.com/catalog/7003" },
    ])
    .returning();
  await db.insert(robloxListingChecks).values(
    links.map((l, i) => ({ uploadRecordId: l.id, isForSale: i < 2, robloxName: ["Red Christmas Bow Parasol", "Parasol 1", "Parasol 2"][i], assetTypeId: 46, ourOnSale: i < 2, httpStatus: 200 }))
  );
  return { owner, asset, links };
}

async function testFlow() {
  console.log("Verifying drafts, confirmation, history, re-nomination and suggestions...");
  const { owner, asset, links } = await seed();

  const view = await getNomination(SKU);
  assert.strictEqual(view.draft, null, "Nothing is saved until Arjun saves");
  assert.strictEqual(view.proposed.item_link, "https://www.roblox.com/catalog/7001", "Item link is the main listing");
  assert.strictEqual(view.proposed.colour_links, "https://www.roblox.com/catalog/7002", "Only on-sale recolours are colour links");
  assert.strictEqual(view.proposed.item_type, "Accessory / Hair");
  assert.strictEqual(view.proposed.season, "Christmas");
  assert.ok(view.evidence.some((e) => e.label === "Weak evidence"), "Missing artifacts are flagged");
  assert.ok(view.problems.some((p) => p.message.includes("Rename the main listing")), "The proposed name differs from Roblox's, so it's flagged");

  const fields = { ...view.proposed, final_name: "Red Christmas Bow Parasol" };
  const draftId = await saveDraft(SKU, fields, owner.id);
  assert.strictEqual(await saveDraft(SKU, fields, owner.id), draftId, "Saving again keeps one draft");
  const saveEvents = await db.select().from(nominationEvents).where(eq(nominationEvents.draftId, draftId));
  assert.strictEqual(saveEvents.length, 1, "Saving the same answers twice records one event");

  await assert.rejects(confirmSubmitted(SKU, { draftId, rightsConfirmed: true, evidence: null }, owner.id), /placeholder names on Roblox: Parasol 1/, "A recolour still named like a placeholder blocks filing");
  // Arjun renames the recolour on Roblox and checks it again.
  await db.insert(robloxListingChecks).values({ uploadRecordId: links[1].id, isForSale: true, robloxName: "Green Christmas Bow Parasol", assetTypeId: 46, ourOnSale: true, httpStatus: 200 });
  await assert.rejects(confirmSubmitted(SKU, { draftId, rightsConfirmed: false, evidence: null }, owner.id), TodaysPicksError, "No confirmation without the rights answer");
  const [draftBefore] = await db.select().from(nominationDrafts).where(eq(nominationDrafts.id, draftId));
  assert.strictEqual(draftBefore.state, "draft", "A refused confirmation leaves a draft, never submitted");

  // Two confirmations at the same moment: one submission, one task update.
  const [a, b] = await Promise.all([
    confirmSubmitted(SKU, { draftId, rightsConfirmed: true, evidence: "Confirmation page seen" }, owner.id),
    confirmSubmitted(SKU, { draftId, rightsConfirmed: true, evidence: "Confirmation page seen" }, owner.id),
  ]);
  assert.ok([a, b].filter((r) => !r.alreadyRecorded).length === 1, "Exactly one confirmation is recorded");
  const comments = await db.select().from(teamTaskComments).where(eq(teamTaskComments.taskId, MARKETING_TASK_ID));
  assert.strictEqual(comments.length, 1, "One update on the marketing task");
  assert.ok(comments[0].body.includes("Red Christmas Bow Parasol") && comments[0].body.includes("1 colour link"), comments[0].body);

  await assert.rejects(saveDraft(SKU, fields, owner.id), /already submitted/, "A submitted nomination can't be edited");
  await assert.rejects(startRenomination(SKU, "x", owner.id), /what changed/i, "Re-nominating needs a reason");

  await undoSubmitted(SKU, draftId, "Clicked by mistake before filing", owner.id);
  const [undone] = await db.select().from(nominationDrafts).where(eq(nominationDrafts.id, draftId));
  assert.ok(undone.state === "draft" && !undone.submittedAt, "Undo returns it to a draft");
  const kinds = (await db.select().from(nominationEvents).where(eq(nominationEvents.draftId, draftId))).map((e) => e.kind).sort();
  assert.deepStrictEqual(kinds, ["saved", "submission_undone", "submitted"], "History keeps the confirmation and the correction");

  await confirmSubmitted(SKU, { draftId, rightsConfirmed: true, evidence: null }, owner.id);
  const second = await startRenomination(SKU, "Added two new colours for the holiday drop", owner.id);
  await assert.rejects(startRenomination(SKU, "Another change to the item", owner.id), TodaysPicksError, "One open attempt at a time");
  const view2 = await getNomination(SKU);
  assert.ok(view2.draft?.id === second && view2.draft.attemptNo === 2 && view2.history.length === 2, "Attempt 2 is open with attempt 1 in history");

  // Suggestions from the sheet.
  const items = await listTodaysPicksPreview();
  const row = { sku: SKU, listingId: "", field: "tags", value: "christmas, parasol, cozy", evidence: "TR006", suggestedBy: "Instinct", suggestedAt: "2026-10-14" };
  const first = await ingestSuggestions(
    [
      row,
      { ...row, field: "item_link", value: "https://www.roblox.com/catalog/1" },
      { ...row, field: "season", value: "x".repeat(21) },
      { ...row, sku: "NOT-A-SKU" },
      { ...row, field: "final_name", listingId: links[0].id, value: "Cozy Christmas Bow Parasol" },
      { ...row, field: "tags", listingId: "00000000-0000-0000-0000-000000000000" },
    ],
    items
  );
  assert.strictEqual(first.added, 2, "Two valid suggestions are stored");
  assert.deepStrictEqual(
    first.refused.map((r) => r.row),
    [3, 4, 5, 7],
    "Refused: a link suggestion, an over-long season, an unknown SKU, a listing from elsewhere"
  );
  const again = await ingestSuggestions([row], items);
  assert.ok(again.added === 0 && again.known === 1, "Re-reading a row stores nothing new");
  const [stillOpen] = await db.select().from(nominationDrafts).where(eq(nominationDrafts.id, second));
  assert.strictEqual(stillOpen.state, "draft", "Suggestions never change a nomination's state");
  assert.strictEqual((await getNomination(SKU)).suggestions.length, 2);
  void asset;
  console.log("Confirmed the nomination flow");
}

async function run() {
  await cleanup();
  testProposals();
  await testFlow();
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All nomination assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
