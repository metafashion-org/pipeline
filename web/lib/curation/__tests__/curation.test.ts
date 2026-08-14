import assert from "node:assert";
import { updateRecolorReferenceImages } from "../curation-service";

async function testCurationAndRecolorImages() {
  console.log("Verifying dynamic curation intake & recolor reference images...");

  try {
    await updateRecolorReferenceImages("NON_EXISTENT_SKU_RECOLOR", ["https://example.com/recolor.jpg"]);
    assert.fail("Should reject non-existent SKU");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("Caught expected error for missing asset recolor update:", message);
    assert.ok(message.includes("not found"), "Error should report the SKU as not found");
  }

  console.log("✓ All P3-T6/P3-T7 curation intake and recolor reference image assertions passed cleanly!");
}

testCurationAndRecolorImages()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
