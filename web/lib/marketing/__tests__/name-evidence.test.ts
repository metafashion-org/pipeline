// Regression cases from the 14 Oct naming review. The quotes below are test fixtures shaped like the
// cited sources (report lines, ranking rows, image correspondences), not copies of the real files.
import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { artifactSkuLinks } from "@/lib/db/schema/artifact_sku_links";
import { nameEvidence } from "@/lib/db/schema/name_evidence";
import { nominationDrafts, nominationEvents } from "@/lib/db/schema/nomination_drafts";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { robloxListingChecks } from "@/lib/db/schema/roblox_listing_checks";
import { ingestEvidenceRows, loadNameEvidence, retireEvidence, type NameEvidenceView } from "../name-evidence";
import { approveField, conflictOnlyNameWords, draftProblems, getNomination, nameWordSources, robloxTypeOf, saveDraft, unsupportedNameWords } from "../nomination-service";
import { listTodaysPicksPreview, TodaysPicksError, type PreviewItem, type PreviewListing } from "../todays-picks-service";

const PREFIX = "TEST-EVID-";

function ev(overrides: Partial<NameEvidenceView>): NameEvidenceView {
  return { id: crypto.randomUUID(), kind: "workbook_row", sourceRef: "test", location: "row 1", quote: "", supports: [], confidence: "high", limits: null, conflict: null, enteredBy: "test", ...overrides };
}

function listing(overrides: Partial<PreviewListing> = {}): PreviewListing {
  return {
    id: "l1",
    url: "https://www.roblox.com/catalog/111",
    robloxAssetId: "111",
    variantLabel: null,
    onSaleAt: "2026-10-13T00:00:00Z",
    isMain: true,
    approvedName: null,
    thumbnailUrl: null,
    lastCheck: { checkedAt: "2026-10-13T00:00:00Z", isForSale: true, priceRobux: 145, robloxName: "x", creatorName: "UGC Items", assetTypeId: 46, ourOnSale: true, error: null },
    ...overrides,
  };
}

function sku(nameEvidenceRows: NameEvidenceView[], overrides: Partial<PreviewItem> = {}): PreviewItem {
  return { sku: "X", itemName: "exploratory", status: "uploaded_to_roblox", brandGroup: null, artifacts: [], trendReasoning: null, nameEvidence: nameEvidenceRows, approvedName: null, referenceImageCount: 0, listings: [listing()], blockers: [], ...overrides };
}

function testRegressionCases() {
  console.log("Verifying the review's naming cases against full evidence...");

  // 0099: the Registry summary of ANA007 lacks "duty"; the full report line has it.
  const belt = sku([], {
    artifacts: [{ artifactId: "ANA007", title: "Controller General tactical orphan scan - Oct 7", description: "Oct 7 snapshot: FAST: Phone Belt 93, Shoulder Strap 76", tags: [] }],
  });
  assert.deepStrictEqual(unsupportedNameWords("Tactical Phone Duty Belt", belt), ["duty"], "The short summary alone doesn't support duty");
  const beltFull = { ...belt, nameEvidence: [ev({ kind: "report_line", sourceRef: "ANA007 Oct 7", location: "line 101", quote: "tactical duty/battle belt with mounted smartphone" })] };
  assert.deepStrictEqual(unsupportedNameWords("Tactical Phone Duty Belt", beltFull), [], "The full line supplies duty; the rest is already in the report");

  // 0057: ranking row (ruffled parasol) plus the actual concept image (bow, heart, flower).
  const parasol = sku([
    ev({ sourceRef: "back-ranking", location: "row 6", quote: "Christmas ruffled parasol" }),
    ev({ kind: "image_correspondence", sourceRef: "concept image", location: "main concept sheet", quote: "Canopy shows a bow, a heart and flowers", supports: ["bow", "heart", "flower"] }),
  ]);
  assert.deepStrictEqual(unsupportedNameWords("Christmas Bow Parasol", parasol), []);

  // 0050: head-ranking row 120 is a santa head (not hood); glasses come from the image.
  const santa = sku([
    ev({ sourceRef: "head-ranking", location: "row 120", quote: "christmas santa head" }),
    ev({ kind: "image_correspondence", sourceRef: "concept image", location: "front view", quote: "Santa face wears round glasses", supports: ["glasses"] }),
  ]);
  assert.deepStrictEqual(unsupportedNameWords("Christmas Santa Head with Glasses", santa), []);
  assert.deepStrictEqual(unsupportedNameWords("Christmas Santa Hood", santa), ["hood"], "Hood isn't in the evidence");

  // 0103: images support snowman and candy-cane motifs; evidence from another SKU isn't borrowed.
  const glasses = sku([ev({ kind: "image_correspondence", sourceRef: "concept image", location: "lens detail", quote: "Snowman and candy cane motifs on Christmas glasses", supports: ["snowman", "candy", "cane", "glasses"] })]);
  assert.deepStrictEqual(unsupportedNameWords("Christmas Snowman Candy Cane Glasses", glasses), []);
  assert.deepStrictEqual(unsupportedNameWords("Christmas Snowman Nose Glasses", glasses), ["nose"], "0054's drink/nose evidence isn't this SKU's");

  // 0081: snowflake boppers are supported; reindeer only by conflicting references, so refused.
  const band = sku([
    ev({ sourceRef: "head-ranking", location: "row 184", quote: "snowflake headband" }),
    ev({ sourceRef: "head-ranking", location: "row 58", quote: "christmas boppers" }),
    ev({ kind: "image_correspondence", sourceRef: "reference images", location: "3 of the references", quote: "Reindeer headband", conflict: "Detailed concept sheet and all seven listings show snowflake boppers" }),
  ]);
  assert.deepStrictEqual(unsupportedNameWords("Christmas Snowflake Bopper Headband", band), []);
  assert.deepStrictEqual(conflictOnlyNameWords("Christmas Snowflake Bopper Headband", band), []);
  assert.deepStrictEqual(conflictOnlyNameWords("Reindeer Snowflake Headband", band), ["reindeer"], "Blending in the conflicting design is refused");
  const blended = draftProblems({ final_name: "Reindeer Snowflake Headband" }, {}, band).map((p) => p.message);
  assert.ok(blended.some((m) => m.includes("Only conflicting evidence supports: reindeer")));

  // Two records with the same label: one conflicting, one not. Records are told apart by id, so the
  // supporting one counts whichever loads first, and the conflict stays visible.
  const sameLabelSupport = ev({ sourceRef: "head-ranking", location: "row 58", quote: "christmas boppers" });
  const sameLabelConflict = ev({ sourceRef: "head-ranking", location: "row 58", quote: "reindeer boppers", conflict: "Concept sheet shows snowflake boppers" });
  for (const order of [
    [sameLabelSupport, sameLabelConflict],
    [sameLabelConflict, sameLabelSupport],
  ]) {
    const twin = sku(order);
    assert.deepStrictEqual(conflictOnlyNameWords("Christmas Bopper", twin), [], "bopper has a non-conflicting record, in either load order");
    assert.deepStrictEqual(conflictOnlyNameWords("Reindeer Bopper", twin), ["reindeer"], "reindeer stays conflict-only, in either load order");
    const bopper = nameWordSources("Christmas Bopper", twin).find((w) => w.word === "bopper")!;
    assert.deepStrictEqual([...bopper.sources].sort(), ["head-ranking row 58", "head-ranking row 58 (conflicting)"], "Both records show; neither hides the other");
  }
  const bothConflicting = sku([ev({ sourceRef: "refs", location: "img", quote: "reindeer", conflict: "a" }), ev({ sourceRef: "refs", location: "img", quote: "reindeer", conflict: "b" })]);
  assert.deepStrictEqual(conflictOnlyNameWords("Reindeer", bothConflicting), ["reindeer"]);

  // 0083: live metadata governs classification; the form keeps its combined category separately.
  const backpack = sku([ev({ sourceRef: "shoulder-ranking", location: "row 9", quote: "reindeer backpack", limits: "Product-family match; not proof of historical origin" })], {
    listings: [listing({ lastCheck: { ...listing().lastCheck!, assetTypeId: 46, priceRobux: 500 } })],
  });
  assert.strictEqual(robloxTypeOf(backpack), "Back accessory (AssetTypeId 46)");
  assert.deepStrictEqual(unsupportedNameWords("Reindeer Backpack", backpack), []);

  // Off-sale mains (0060, 0079, 0081, 0082 at the last check) are never ready to file.
  const offSale = sku([], { listings: [listing({ lastCheck: { ...listing().lastCheck!, isForSale: false } })] });
  assert.ok(draftProblems({}, {}, offSale).some((p) => p.message === "Roblox shows the main listing off sale"));
  console.log("Confirmed the regression cases");
}

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(nameEvidence).where(inArray(nameEvidence.assetId, ids));
    await db.delete(nominationDrafts).where(inArray(nominationDrafts.assetId, ids));
    await db.delete(uploadRecords).where(inArray(uploadRecords.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
}

async function testStorageAndApproval() {
  console.log("Verifying evidence ingest, scoping, retirement and approval carried from a review...");
  await cleanup();
  const [belt] = await db.insert(assets).values({ sku: `${PREFIX}0099`, itemName: "tactical waist belt with phone maroon", currentStatus: "uploaded_to_roblox" }).returning();
  const [other] = await db.insert(assets).values({ sku: `${PREFIX}0054`, itemName: "snowman drink", currentStatus: "uploaded_to_roblox" }).returning();
  for (const a of [belt, other]) {
    const [l] = await db.insert(uploadRecords).values({ assetId: a.id, robloxAssetId: a === belt ? "9901" : "9902", robloxItemUrl: `https://www.roblox.com/catalog/${a === belt ? "9901" : "9902"}`, onSaleAt: new Date(), mainAt: new Date() }).returning();
    await db.insert(robloxListingChecks).values({ uploadRecordId: l.id, isForSale: true, robloxName: "Tactical Phone Duty Belt", assetTypeId: 47, ourOnSale: true, httpStatus: 200 });
  }
  const live = (await listTodaysPicksPreview()).map((i) => i.sku);
  const base = { sku: belt.sku, kind: "report_line", sourceRef: "ANA007 Oct 7", location: "line 101", quote: "tactical duty/battle belt with mounted smartphone", supports: "phone", confidence: "high", limits: "", conflict: "", enteredBy: "instinct" };
  const result = await ingestEvidenceRows(
    [
      base,
      { ...base, kind: "guess" },
      { ...base, location: "" },
      { ...base, quote: "" },
      { ...base, confidence: "certain" },
      { ...base, sku: "NOT-LIVE" },
      { ...base, sku: other.sku, quote: "snowman nose in a cocoa mug", supports: "nose" },
    ],
    live
  );
  assert.strictEqual(result.added, 2);
  assert.deepStrictEqual(result.refused.map((r) => r.row), [3, 4, 5, 6, 7]);
  assert.strictEqual((await ingestEvidenceRows([base], live)).known, 1, "Re-reading a row stores nothing new");
  assert.strictEqual((await db.select().from(artifactSkuLinks).where(eq(artifactSkuLinks.assetId, belt.id))).length, 0, "No design-origin link is created");

  // Name entry works without any origin link; approval uses full evidence and the review reference.
  const draftId = await saveDraft(belt.sku, { final_name: "Tactical Phone Duty Belt", tags: "Tactical, Waist Accessory, Phone Belt, Utility Gear", item_type: "Accessory / Hair" }, null);
  const version = async () => (await db.select().from(nominationDrafts).where(eq(nominationDrafts.id, draftId)))[0].updatedAt.toISOString();
  const reviewRef = "Instinct review 8gg6ecp6y8vb, Arjun approved 14 Oct 2026 10:39 IST";
  await approveField(belt.sku, { draftId, version: await version(), field: "final_name", reviewRef }, null);
  await approveField(belt.sku, { draftId, version: await version(), field: "answers", reviewRef }, null);
  const view = await getNomination(belt.sku);
  assert.ok(view.approvedNow.final_name.approved && view.approvedNow.final_name.reviewRef === reviewRef, "Approval carries the review reference");
  assert.ok(view.approvedNow.answers.approved);
  assert.deepStrictEqual(view.nameWords.find((w) => w.word === "duty")?.sources, ["ANA007 Oct 7 line 101"]);
  const [approvedEvent] = await db.select().from(nominationEvents).where(eq(nominationEvents.kind, "approved_final_name"));
  assert.strictEqual(approvedEvent.payload.reviewRef, reviewRef);

  // A stale version can't be approved; changed content needs a new approval.
  const stale = await version();
  await saveDraft(belt.sku, { final_name: "Tactical Phone Duty Belt", tags: "Tactical, Phone Belt", item_type: "Accessory / Hair" }, null);
  await assert.rejects(approveField(belt.sku, { draftId, version: stale, field: "answers" }, null), /changed after you reviewed it/);
  assert.ok(!(await getNomination(belt.sku)).approvedNow.answers.approved, "Changed answers are no longer approved");
  assert.ok((await getNomination(belt.sku)).approvedNow.final_name.approved, "The unchanged name keeps its approval");

  // The other SKU's evidence isn't borrowed.
  const otherEvidence = (await loadNameEvidence([other.id])).get(other.id) ?? [];
  assert.strictEqual(otherEvidence.length, 1);
  assert.ok(!(await getNomination(belt.sku)).nameEvidence.some((e) => e.quote.includes("nose")));

  // Retiring keeps the row and stops it supporting the name.
  const [record] = (await loadNameEvidence([belt.id])).get(belt.id)!;
  await retireEvidence(belt.sku, record.id, "Line number was wrong in the sheet", null);
  const [kept] = await db.select().from(nameEvidence).where(eq(nameEvidence.id, record.id));
  assert.ok(kept.retiredAt && kept.retiredReason, "Retired, not deleted");
  const after = await getNomination(belt.sku);
  assert.ok(after.problems.some((p) => p.message.startsWith("Not in any evidence for this SKU")), "Without the record the name is unsupported again");
  await assert.rejects(approveField(belt.sku, { draftId, version: await version(), field: "final_name" }, null), TodaysPicksError);
  console.log("Confirmed storage and approval");
}

async function run() {
  testRegressionCases();
  await testStorageAndApproval();
}

run()
  .then(async () => {
    await cleanup();
    console.log("✓ All naming evidence assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
