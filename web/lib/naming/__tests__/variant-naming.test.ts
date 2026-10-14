import assert from "node:assert";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { nameEvidence } from "@/lib/db/schema/name_evidence";
import { nameProposals } from "@/lib/db/schema/name_proposals";
import { uploadRecords } from "@/lib/db/schema/upload_records";
import { getReadyForUploadQueue } from "@/lib/publisher/publisher-service";
import { draftProblems } from "@/lib/marketing/nomination-service";
import type { PreviewItem, PreviewListing } from "@/lib/marketing/todays-picks-service";
import { approveVariants, listVariantNaming, runVariantNaming, variantName, type VariantCaller } from "../variant-naming";

const PREFIX = "TEST-VARIANT-";
const PIXEL = { mediaType: "image/png" as const, base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" };

async function cleanup() {
  const rows = await db.select({ id: assets.id }).from(assets).where(like(assets.sku, `${PREFIX}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.delete(auditLog).where(inArray(auditLog.entityId, ids));
    await db.delete(nameEvidence).where(inArray(nameEvidence.assetId, ids));
    await db.delete(nameProposals).where(inArray(nameProposals.assetId, ids));
    await db.delete(uploadRecords).where(inArray(uploadRecords.assetId, ids));
    await db.delete(assets).where(inArray(assets.id, ids));
  }
  await db.delete(auditLog).where(eq(auditLog.entityType, "naming"));
}

const COLOURS = ["red", "frosty blue", "pastel PINK"];

// Answers like Claude: one colour per listing (plus a stray answer for a listing that isn't the
// item's), or three colourways from a recolour sheet.
function fakeCaller(calls: string[][]): VariantCaller {
  return async (items) => {
    calls.push(items.map((i) => i.sku));
    return {
      refusal: null,
      usage: { input_tokens: 500 },
      result: {
        items: items.map((i) => ({
          sku: i.sku,
          variants:
            i.kind === "listings"
              ? [...i.listings.map((l, n) => ({ listing_id: l.id, colour: COLOURS[n], image_note: `The parasol canopy is ${COLOURS[n]}` })), { listing_id: "not-this-items", colour: "Gold", image_note: "Gold" }]
              : COLOURS.map((c) => ({ listing_id: "", colour: c, image_note: `A ${c} parasol on the recolour sheet` })),
        })),
      },
    };
  };
}

async function test() {
  await cleanup();
  console.log("Verifying name assembly...");
  assert.strictEqual(variantName("pastel PINK", "Christmas Bow Parasol"), "Pastel Pink Christmas Bow Parasol");
  assert.strictEqual(variantName("red and white!", "Christmas Bow Parasol"), "Red and White Christmas Bow Parasol");

  const img = (id: string) => [{ provider: "google_drive", externalId: id, sizeBytes: 10, mimeType: "image/png" }];
  const trend = { trendReasoning: "Christmas bow parasol trend" };
  const [ready] = await db
    .insert(assets)
    .values({ sku: `${PREFIX}READY`, itemName: "parasol", currentStatus: "ready_for_upload", approvedName: "Christmas Bow Parasol", recolorReferenceImages: img("sheet-1"), briefFields: trend })
    .returning();
  const [live] = await db.insert(assets).values({ sku: `${PREFIX}LIVE`, itemName: "parasol", currentStatus: "uploaded_to_roblox", approvedName: "Christmas Bow Parasol", briefFields: trend }).returning();
  const listings = await db
    .insert(uploadRecords)
    .values(
      // Distinct creation times keep the listings in upload order.
      ["9101", "9102", "9103"].map((id, n) => ({ assetId: live.id, robloxAssetId: id, robloxItemUrl: `https://www.roblox.com/catalog/${id}`, onSaleAt: new Date(), mainAt: n === 0 ? new Date() : null, createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)) }))
    )
    .returning();
  await db.insert(assets).values({ sku: `${PREFIX}NOBASE`, itemName: "no base", currentStatus: "ready_for_upload", recolorReferenceImages: img("sheet-2") });

  console.log("Verifying one call covers both items and the base-name gate...");
  const calls: string[][] = [];
  const loadImages = async (item: { kind: string; listings: { id: string }[] }) =>
    item.kind === "listings" ? item.listings.map((l) => ({ label: l.id, listingId: l.id, image: PIXEL })) : [{ label: "sheet", listingId: "", image: PIXEL }];
  const first = await runVariantNaming({ onlySkus: [`${PREFIX}READY`, `${PREFIX}LIVE`, `${PREFIX}NOBASE`], caller: fakeCaller(calls), loadImages });
  assert.strictEqual(first.named, 2, "Only items with an approved base name get variant names");
  assert.deepStrictEqual(calls.length, 1, "Both items in one call");
  const views = await listVariantNaming();
  const readyView = views.find((v) => v.sku === `${PREFIX}READY`)!;
  const liveView = views.find((v) => v.sku === `${PREFIX}LIVE`)!;
  assert.deepStrictEqual(readyView.candidates.map((c) => c.name), ["Red Christmas Bow Parasol", "Frosty Blue Christmas Bow Parasol", "Pastel Pink Christmas Bow Parasol"]);
  assert.strictEqual(liveView.candidates.length, 3, "A stray answer for another item's listing is dropped");
  assert.deepStrictEqual(liveView.candidates.map((c) => c.robloxAssetId), ["9101", "9102", "9103"]);
  assert.ok(liveView.candidates.every((c) => c.problems.length === 0), JSON.stringify(liveView.candidates.map((c) => c.problems)));
  const evidence = await db.select().from(nameEvidence).where(eq(nameEvidence.assetId, live.id));
  assert.strictEqual(evidence.length, 3, "Each thumbnail reading is evidence");
  assert.strictEqual((await runVariantNaming({ onlySkus: [`${PREFIX}LIVE`], caller: fakeCaller(calls), loadImages })).skipped, 1, "Unchanged inputs aren't sent again");

  console.log("Verifying approval rules...");
  const named = (v: typeof liveView, edit: Record<number, string> = {}) => v.candidates.map((c, i) => ({ listingId: c.listingId, colour: c.colour, name: edit[i] ?? c.name }));
  await assert.rejects(approveVariants(live.sku, { proposalId: liveView.proposalId, names: named(liveView, { 1: "Red Christmas Bow Parasol" }) }, null), /share a name/);
  await assert.rejects(approveVariants(live.sku, { proposalId: liveView.proposalId, names: named(liveView, { 1: "Blue Parasol" }) }, null), /Must end with the base name/);
  await assert.rejects(approveVariants(live.sku, { proposalId: liveView.proposalId, names: named(liveView, { 1: "Neon Christmas Bow Parasol" }) }, null), /Not in any evidence: neon/);
  await assert.rejects(approveVariants(live.sku, { proposalId: liveView.proposalId, names: named(liveView, { 1: "Frosty Blue Pastel Pink Frosty Christmas Bow Parasol" }) }, null), /limit is 49/);
  await approveVariants(live.sku, { proposalId: liveView.proposalId, names: named(liveView) }, null);
  const saved = await db.select().from(uploadRecords).where(eq(uploadRecords.assetId, live.id));
  assert.deepStrictEqual(saved.map((l) => [l.robloxAssetId, l.approvedName, l.variantLabel]).sort(), [
    ["9101", "Red Christmas Bow Parasol", "red"],
    ["9102", "Frosty Blue Christmas Bow Parasol", "frosty blue"],
    ["9103", "Pastel Pink Christmas Bow Parasol", "pastel PINK"],
  ]);
  await approveVariants(ready.sku, { proposalId: readyView.proposalId, names: named(readyView) }, null);
  const queueItem = (await getReadyForUploadQueue()).find((q) => q.sku === ready.sku)!;
  assert.deepStrictEqual(queueItem.approvedColourways.map((c) => c.name), readyView.candidates.map((c) => c.name), "The uploader sees the colourway names");
  await assert.rejects(approveVariants(ready.sku, { proposalId: readyView.proposalId, names: named(readyView) }, null), /latest open suggestion/, "An approved set can't be approved twice");

  console.log("Verifying Today's Picks checks each listing against its own name...");
  const check = (name: string) => ({ checkedAt: "", isForSale: true, priceRobux: 145, robloxName: name, creatorName: "UGC Items", assetTypeId: 46, ourOnSale: true, error: null });
  const l = (id: string, approvedName: string, robloxName: string, isMain = false): PreviewListing => ({ id, url: `https://www.roblox.com/catalog/${id}`, robloxAssetId: id, variantLabel: null, onSaleAt: "x", isMain, approvedName, thumbnailUrl: null, lastCheck: check(robloxName) });
  const item: PreviewItem = {
    sku: "X", itemName: "x", status: "uploaded_to_roblox", brandGroup: null, artifacts: [], trendReasoning: "Christmas bow parasol trend", nameEvidence: [], approvedName: "Christmas Bow Parasol", referenceImageCount: 0, blockers: [],
    listings: [l("9101", "Red Christmas Bow Parasol", "Red Christmas Bow Parasol", true), l("9102", "Frosty Blue Christmas Bow Parasol", "Umbrella-2")],
  };
  const fields = { final_name: "Christmas Bow Parasol", colour_links: "https://www.roblox.com/catalog/9102" };
  const roblox = draftProblems(fields, {}, item).filter((p) => p.field === "roblox").map((p) => p.message);
  assert.ok(!roblox.some((m) => m.startsWith("Rename the main listing")), "The main listing matches its own variant name");
  assert.ok(roblox.some((m) => m.includes('"Umbrella-2" to "Frosty Blue Christmas Bow Parasol"')), "A recolour not yet renamed is named with its target");
  console.log("Confirmed variant naming");
}

test()
  .then(async () => {
    await cleanup();
    console.log("✓ All variant naming assertions passed cleanly against a live DB!");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
