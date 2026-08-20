import assert from "node:assert";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { eq } from "drizzle-orm";
import {
  seedDefaultCurationFieldConfig,
  getBriefFieldsForAsset,
  updateCurationFieldConfig,
} from "../curation-service";
import { renderAssignmentEmailHtml } from "@/lib/email/templates/assignment-email";

const TEST_SKU = "TEST-BRIEF-FIELD-SKU";

async function testBriefFieldSelector() {
  console.log("Verifying P3-T9: brief field selector changes assignment email content with no code change...");

  await seedDefaultCurationFieldConfig();

  await db.delete(assets).where(eq(assets.sku, TEST_SKU));
  const [asset] = await db
    .insert(assets)
    .values({
      sku: TEST_SKU,
      itemName: "Brief Field Test Asset",
      deadline: new Date("2026-09-01"),
      recolorReferenceImages: [{ provider: "filestore", externalId: "https://example.com/recolor.png" }],
    })
    .returning();

  try {
    // 1. With the field enabled (default), it shows up in the brief fields
    const fieldsOn = await getBriefFieldsForAsset(asset.id);
    const deadlineFieldOn = fieldsOn.find((f) => f.key === "deadline");
    assert.ok(deadlineFieldOn, "deadline should appear in brief fields when includeInArtistEmail is true");

    const emailWithField = renderAssignmentEmailHtml({
      sku: asset.sku,
      itemName: asset.itemName,
      artistName: "Test Artist",
      briefFields: fieldsOn,
    });
    assert.ok(emailWithField.includes("Deadline"), "Rendered email should include the Deadline row when enabled");

    // 2. Toggling includeInArtistEmail off changes what the NEXT email contains - no code change
    await updateCurationFieldConfig("deadline", { includeInArtistEmail: false });
    const fieldsOff = await getBriefFieldsForAsset(asset.id);
    assert.ok(!fieldsOff.find((f) => f.key === "deadline"), "deadline should be excluded once toggled off");

    const emailWithoutField = renderAssignmentEmailHtml({
      sku: asset.sku,
      itemName: asset.itemName,
      artistName: "Test Artist",
      briefFields: fieldsOff,
    });
    assert.ok(!emailWithoutField.includes("Deadline"), "Rendered email should NOT include the Deadline row once toggled off");

    // restore for idempotency of future runs
    await updateCurationFieldConfig("deadline", { includeInArtistEmail: true });
  } finally {
    await db.delete(assets).where(eq(assets.sku, TEST_SKU));
  }

  console.log("✓ All P3-T9 assertions passed cleanly against a live DB!");
}

testBriefFieldSelector()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
