import assert from "node:assert";
import { getArtifactPrefix, generateTypedArtifactId } from "../artifacts-service";

async function testArtifactIdGenerator() {
  console.log("Verifying knowledge artifact typed-ID generator...");

  // 1. Prefix mappings
  assert.strictEqual(getArtifactPrefix("tech_spec"), "SPEC", "tech_spec prefix must be SPEC");
  assert.strictEqual(getArtifactPrefix("mannequin_rig"), "RIG", "mannequin_rig prefix must be RIG");
  assert.strictEqual(getArtifactPrefix("recruiting_faq"), "FAQ", "recruiting_faq prefix must be FAQ");
  assert.strictEqual(getArtifactPrefix("style_guide"), "STYLE", "style_guide prefix must be STYLE");
  assert.strictEqual(getArtifactPrefix("custom_type"), "CUST", "custom prefix fallback must use first 4 letters");

  // 2. ID generation against the live DB - no failure path to catch here, this
  // call is expected to succeed whenever the DB is reachable.
  const id = await generateTypedArtifactId("tech_spec");
  assert.ok(id.startsWith("SPEC-"), "Generated ID must start with SPEC-");
  assert.strictEqual(id.length, 9, "Generated ID must be formatted as SPEC-0001 (length 9)");

  console.log("✓ All P3-T2 typed-ID generator assertions passed cleanly!");
}

testArtifactIdGenerator()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
