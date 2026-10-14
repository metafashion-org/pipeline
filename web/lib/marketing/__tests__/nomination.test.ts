import assert from "node:assert";
import { and, desc, eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { personnel } from "@/lib/db/schema/personnel";
import { teamTasks } from "@/lib/db/schema/team_tasks";
import { teamTaskComments } from "@/lib/db/schema/team_task_comments";
import { teamTaskHelpers } from "@/lib/db/schema/team_task_helpers";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { robloxListingChecks } from "@/lib/db/schema/roblox_listing_checks";
import { nominationDrafts, nominationEvents } from "@/lib/db/schema/nomination_drafts";
import { marketingSuggestions } from "@/lib/db/schema/marketing_suggestions";
import {
  approveField,
  confirmSubmitted,
  draftProblems,
  getNomination,
  ingestSuggestions,
  MARKETING_TASK_ID,
  answersValue,
  nameTerms,
  proposeDraft,
  proposeTags,
  saveDraft,
  seasonFrom,
  undoSubmitted,
} from "../nomination-service";
import { listTodaysPicksPreview, TodaysPicksError, type PreviewItem, type PreviewListing } from "../todays-picks-service";

const SKU_PREFIX = "TEST-NOM-";
const SKU = `${SKU_PREFIX}PARASOL`;
const BARE_SKU = `${SKU_PREFIX}BARE`;
const OWNER_EMAIL = "test-nom-owner@example.test";
const TREND = "Bow parasols trend for the holidays https://www.roblox.com/catalog/72992511107820/Christmas-Bow-Parasol-Umbrella";

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
    lastCheck: { checkedAt: "2026-10-13T00:00:00Z", isForSale: true, priceRobux: 145, robloxName: "Christmas Bow Parasol", creatorName: "UGC Items", assetTypeId: 46, ourOnSale: true, error: null },
    ...overrides,
  };
}

function item(overrides: Partial<PreviewItem> = {}): PreviewItem {
  return {
    sku: "X",
    itemName: "exploratory parasol idea v2",
    status: "uploaded_to_roblox",
    brandGroup: null,
    artifacts: [{ artifactId: "TR006", title: "Christmas", description: "Christmas assets", tags: ["festive"] }],
    trendReasoning: TREND,
    nameEvidence: [],
    referenceImageCount: 0,
    blockers: [],
    listings: [listing("main", "111", { isMain: true }), listing("r1", "222", { lastCheck: { ...listing("x", "1").lastCheck!, robloxName: "Green Christmas Bow Parasol" } })],
    ...overrides,
  };
}

function testProposals() {
  console.log("Verifying names come from evidence, never from the internal name...");
  const terms = nameTerms(item()).map((t) => t.term);
  assert.ok(terms.includes("christmas") && terms.includes("parasol") && terms.includes("bow") && terms.includes("umbrella"), `Words from artifacts, trend text and the trend link: ${terms}`);
  assert.ok(!terms.includes("exploratory") && !terms.includes("idea"), "The internal item name is not a source");
  assert.strictEqual(nameTerms(item()).find((t) => t.term === "christmas")?.sources.length, 2, "christmas is in the artifact and the trend");
  assert.strictEqual(proposeDraft(item()).proposed.final_name, "", "No final name is generated");
  const bare = proposeDraft(item({ artifacts: [], trendReasoning: null }));
  assert.ok(bare.evidence.some((e) => e.label === "Missing evidence"), "Missing evidence is flagged");
  assert.strictEqual(seasonFrom("christmas bow"), "Christmas");
  const tags = proposeTags("Christmas Bow Parasol", ["christmas", "festive", "umbrella"], 46);
  assert.ok(tags.length <= 80 && tags.includes("back accessory") && tags.split(", ").filter((t) => t === "christmas").length === 1, tags);

  const good = {
    final_name: "Christmas Bow Parasol",
    item_link: "https://www.roblox.com/catalog/111",
    item_type: "Accessory / Hair",
    tags: "christmas, parasol",
    colour_links: "https://www.roblox.com/catalog/222",
  };
  const approvals = {
    final_name: { value: good.final_name, by: null, at: "" },
    colour_links: { value: good.colour_links, by: null, at: "" },
    answers: { value: answersValue(good), by: null, at: "" },
  };
  assert.deepStrictEqual(draftProblems(good, approvals, item()), [], "An approved, grounded draft has no problems");
  const expect = (fields: Record<string, string>, text: string, it: PreviewItem = item(), appr: typeof approvals | Record<string, never> = approvals) => {
    const found = draftProblems({ ...good, ...fields }, appr, it);
    assert.ok(found.some((p) => p.message.includes(text)), `Expected "${text}" in ${JSON.stringify(found)}`);
  };
  expect({}, "Approve the final name", item(), { colour_links: approvals.colour_links } as typeof approvals);
  expect({}, "Review and approve the colour links", item(), { final_name: approvals.final_name } as typeof approvals);
  expect({ colour_links: "" }, "Review and approve the colour links");
  expect({}, "Add naming evidence", item({ artifacts: [], trendReasoning: null }));
  expect({ tags: "christmas, bow" }, "Approve the item-page answers");
  expect({ final_name: "belt 1" }, "placeholder");
  expect({ final_name: "A".repeat(50) }, "limit is 49");
  expect({ tags: "x".repeat(81) }, "limit is 80");
  expect({ season: "x".repeat(21) }, "limit is 20");
  expect({ item_type: "Hat" }, "Pick an item type");
  expect({ item_link: "https://www.roblox.com/catalog/222" }, "isn't this SKU's main listing");
  expect({ colour_links: "https://www.roblox.com/catalog/999" }, "isn't one of this SKU's listings");
  expect({ colour_links: "https://www.roblox.com/catalog/111" }, "main listing can't also be");
  expect({ final_name: "Bow Parasol" }, 'Rename the main listing on Roblox from "Christmas Bow Parasol"');
  console.log("Confirmed proposals and rules");
}

async function seed() {
  const [owner] = await db.insert(personnel).values({ name: "Nom Owner", email: OWNER_EMAIL, roles: ["admin"] }).returning();
  await db.insert(teamTasks).values({ id: MARKETING_TASK_ID, title: "Marketing company function", area: "marketing", ownerId: owner.id, isPrivate: true });
  const [asset] = await db.insert(assets).values({ sku: SKU, itemName: "exploratory parasol idea", currentStatus: "uploaded_to_roblox", briefFields: { trendReasoning: TREND } }).returning();
  const links = await db
    .insert(uploadRecords)
    .values([
      { assetId: asset.id, robloxAssetId: "7001", robloxItemUrl: "https://www.roblox.com/catalog/7001", onSaleAt: new Date(), mainAt: new Date() },
      { assetId: asset.id, robloxAssetId: "7002", robloxItemUrl: "https://www.roblox.com/catalog/7002", onSaleAt: new Date() },
    ])
    .returning();
  await db.insert(robloxListingChecks).values([
    { uploadRecordId: links[0].id, isForSale: true, robloxName: "Christmas Bow Parasol", assetTypeId: 46, ourOnSale: true, httpStatus: 200 },
    { uploadRecordId: links[1].id, isForSale: true, robloxName: "Green Christmas Bow Parasol", assetTypeId: 46, ourOnSale: true, httpStatus: 200 },
  ]);
  const [bare] = await db.insert(assets).values({ sku: BARE_SKU, itemName: "belt idea", currentStatus: "uploaded_to_roblox" }).returning();
  await db.insert(uploadRecords).values({ assetId: bare.id, robloxAssetId: "7101", robloxItemUrl: "https://www.roblox.com/catalog/7101", onSaleAt: new Date(), mainAt: new Date() });
  return { owner, asset };
}

const events = async (draftId: string, kind: string) => (await db.select().from(nominationEvents).where(and(eq(nominationEvents.draftId, draftId), eq(nominationEvents.kind, kind)))).length;
const comments = async () => db.select().from(teamTaskComments).where(eq(teamTaskComments.taskId, MARKETING_TASK_ID));
const version = async (draftId: string) => (await db.select().from(nominationDrafts).where(eq(nominationDrafts.id, draftId)))[0].updatedAt.toISOString();
const draftState = async (draftId: string) => (await db.select().from(nominationDrafts).where(eq(nominationDrafts.id, draftId)))[0].state;

async function testFlow() {
  console.log("Verifying approvals, atomic confirmation, undo and re-confirm, concurrency and privacy...");
  const { owner, asset } = await seed();

  // A SKU with no artifacts or trend origin gets no name and can't approve one.
  const bareId = await saveDraft(BARE_SKU, { final_name: "Belt Idea" }, owner.id);
  await assert.rejects(approveField(BARE_SKU, { draftId: bareId, version: await version(bareId), field: "final_name" }, owner.id), /Add naming evidence/);

  const view = await getNomination(SKU);
  assert.strictEqual(view.proposed.final_name, "", "The final name starts unset");
  assert.ok(view.nameTerms.some((t) => t.term === "parasol"), "Evidence words are offered");
  const draftId = await saveDraft(SKU, { ...view.proposed, final_name: "Christmas Bow Parasol" }, owner.id);
  assert.strictEqual(await saveDraft(SKU, { ...view.proposed, final_name: "Christmas Bow Parasol" }, owner.id), draftId);
  assert.strictEqual(await events(draftId, "saved"), 1, "Saving unchanged answers records nothing");
  assert.ok((await getNomination(SKU)).problems.some((p) => p.message === "Approve the final name"), "Saving never approves");

  // A name word that no artifact or trend origin contains can't be approved.
  await saveDraft(SKU, { ...view.proposed, final_name: "Christmas Bow Parasol Deluxe" }, owner.id);
  await assert.rejects(approveField(SKU, { draftId: draftId, version: await version(draftId), field: "final_name" }, owner.id), /aren't in any evidence for this SKU: deluxe/);
  await saveDraft(SKU, { ...view.proposed, final_name: "Christmas Bow Parasol" }, owner.id);

  await approveField(SKU, { draftId: draftId, version: await version(draftId), field: "final_name" }, owner.id);
  await approveField(SKU, { draftId: draftId, version: await version(draftId), field: "colour_links" }, owner.id);
  await approveField(SKU, { draftId: draftId, version: await version(draftId), field: "answers" }, owner.id);
  await assert.rejects(confirmSubmitted(SKU, { draftId, version: await version(draftId), rightsConfirmed: false, evidence: null }, owner.id), TodaysPicksError, "No confirmation without the rights answer");

  // Edited after review: the version Arjun saw is stale, so confirming it records nothing.
  const reviewed = await version(draftId);
  await saveDraft(SKU, { ...view.proposed, final_name: "Christmas Bow Parasol", tags: "christmas, parasol, umbrella" }, owner.id);
  await assert.rejects(confirmSubmitted(SKU, { draftId, version: reviewed, rightsConfirmed: true, evidence: null }, owner.id), /changed after you reviewed it/);
  assert.strictEqual(await draftState(draftId), "draft");
  assert.strictEqual(await events(draftId, "owner_confirmed_filed"), 0);

  // An edit racing a confirmation: whichever wins, a filing never records answers other than the
  // ones it was confirmed with, and the loser fails cleanly.
  for (let round = 0; round < 5; round++) {
    await approveField(SKU, { draftId: draftId, version: await version(draftId), field: "answers" }, owner.id);
    const seen = await version(draftId);
    const tags = `christmas, parasol, round ${round}`;
    const [edit, confirm] = await Promise.allSettled([
      saveDraft(SKU, { ...view.proposed, final_name: "Christmas Bow Parasol", tags }, owner.id),
      confirmSubmitted(SKU, { draftId, version: seen, rightsConfirmed: true, evidence: null }, owner.id),
    ]);
    assert.ok(edit.status === "rejected" || confirm.status === "rejected", "An edit and a confirmation of the old version can't both succeed");
    const [row] = await db.select().from(nominationDrafts).where(eq(nominationDrafts.id, draftId));
    if (row.state === "submitted") {
      const [filedEvent] = await db.select().from(nominationEvents).where(and(eq(nominationEvents.draftId, draftId), eq(nominationEvents.kind, "owner_confirmed_filed"))).orderBy(desc(nominationEvents.createdAt)).limit(1);
      assert.deepStrictEqual(filedEvent.payload.fields, row.fields, "The filed answers are exactly the stored ones");
      assert.notStrictEqual((row.fields as Record<string, string>).tags, tags, "The racing edit was not recorded as filed");
      await undoSubmitted(SKU, draftId, "Test race round reset", owner.id);
    } else {
      assert.strictEqual(confirm.status, "rejected", "Still a draft means the confirmation was refused");
    }
  }
  // Put back the reviewed answers and approvals for the rest of the test.
  await saveDraft(SKU, { ...view.proposed, final_name: "Christmas Bow Parasol" }, owner.id);
  await approveField(SKU, { draftId: draftId, version: await version(draftId), field: "colour_links" }, owner.id);
  await approveField(SKU, { draftId: draftId, version: await version(draftId), field: "answers" }, owner.id);
  await db.delete(teamTaskComments).where(eq(teamTaskComments.taskId, MARKETING_TASK_ID));
  await db.delete(nominationEvents).where(and(eq(nominationEvents.draftId, draftId), inArray(nominationEvents.kind, ["owner_confirmed_filed", "confirmation_undone"])));
  await db.delete(auditLog).where(eq(auditLog.entityId, asset.id));

  // Failure: the task update fails (task missing), so nothing of the confirmation is kept.
  await db.delete(teamTasks).where(eq(teamTasks.id, MARKETING_TASK_ID));
  await assert.rejects(confirmSubmitted(SKU, { draftId, version: await version(draftId), rightsConfirmed: true, evidence: null }, owner.id));
  assert.strictEqual(await draftState(draftId), "draft", "Rolled back: still a draft");
  assert.strictEqual(await events(draftId, "owner_confirmed_filed"), 0, "Rolled back: no history event");
  const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, asset.id), eq(auditLog.action, "confirmTodaysPicksNomination")));
  assert.strictEqual(audits.length, 0, "Rolled back: no audit row");
  await db.insert(teamTasks).values({ id: MARKETING_TASK_ID, title: "Marketing company function", area: "marketing", ownerId: owner.id, isPrivate: true });

  // Two confirmations at once: one filing, one event, one task update.
  const current = await version(draftId);
  const both = await Promise.all([1, 2].map(() => confirmSubmitted(SKU, { draftId, version: current, rightsConfirmed: true, evidence: "Confirmation page seen" }, owner.id)));
  assert.strictEqual(both.filter((r) => !r.alreadyRecorded).length, 1);
  assert.strictEqual(await events(draftId, "owner_confirmed_filed"), 1);
  assert.strictEqual((await comments()).length, 1);
  assert.ok((await comments())[0].body.includes("Owner-confirmed, not verified with Roblox") && (await comments())[0].body.includes("item page only"));

  await assert.rejects(saveDraft(SKU, { final_name: "Other" }, owner.id), /recorded as filed/, "A filed nomination can't be edited");

  // Two undos at once: one succeeds, the other gets a clear error.
  const undos = await Promise.allSettled([1, 2].map(() => undoSubmitted(SKU, draftId, "Clicked before filing it", owner.id)));
  assert.strictEqual(undos.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok((undos.find((r) => r.status === "rejected") as PromiseRejectedResult).reason instanceof TodaysPicksError);
  assert.strictEqual(await draftState(draftId), "draft");

  // Re-confirm keeps both confirmations and the correction in history.
  await confirmSubmitted(SKU, { draftId, version: await version(draftId), rightsConfirmed: true, evidence: null }, owner.id);
  assert.strictEqual(await events(draftId, "owner_confirmed_filed"), 2, "Both confirmations are kept");
  assert.strictEqual(await events(draftId, "confirmation_undone"), 1);
  const bodies = (await comments()).map((c) => c.body);
  assert.strictEqual(bodies.length, 3, "Confirm, correction, confirm: one update each, none duplicated");
  assert.strictEqual(bodies.filter((b) => b.startsWith("Correction")).length, 1);

  // Undo while another draft is open: a clear error, not a database failure.
  await db.insert(nominationDrafts).values({ assetId: asset.id, attemptNo: 2, formVersion: "test", fields: {} });
  await assert.rejects(undoSubmitted(SKU, draftId, "Clicked before filing it", owner.id), /already has another open draft/);
  assert.strictEqual(await draftState(draftId), "submitted");

  // The private task keeps its audience: no new helpers, no mentions, still private.
  const [task] = await db.select().from(teamTasks).where(eq(teamTasks.id, MARKETING_TASK_ID));
  assert.strictEqual(task.isPrivate, true);
  assert.strictEqual((await db.select().from(teamTaskHelpers).where(eq(teamTaskHelpers.taskId, MARKETING_TASK_ID))).length, 0);
  assert.ok((await comments()).every((c) => c.mentionedIds.length === 0), "No one is @mentioned");

  // Suggestions from the sheet are validated, stored once, and never change state.
  const items = await listTodaysPicksPreview();
  const row = { sku: SKU, listingId: "", field: "final_name", value: "Christmas Bow Parasol", evidence: "TR006", suggestedBy: "Instinct", suggestedAt: "2026-10-14" };
  const first = await ingestSuggestions([row, { ...row, field: "colour_links", value: "x" }, { ...row, field: "season", value: "x".repeat(21) }, { ...row, sku: "NOPE" }], items);
  assert.strictEqual(first.added, 1);
  assert.deepStrictEqual(first.refused.map((r) => r.row), [3, 4, 5]);
  assert.strictEqual((await ingestSuggestions([row], items)).known, 1, "Re-reading a row stores nothing new");
  assert.strictEqual(await draftState(draftId), "submitted", "Suggestions never change state");
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
