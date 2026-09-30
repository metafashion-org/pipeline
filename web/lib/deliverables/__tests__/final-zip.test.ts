import assert from "node:assert";
import { checkFinalZip } from "../final-zip";

const MB = 1024 * 1024;

function testFinalZipRules() {
  console.log("Verifying final files are handed in as one .zip under the size limit...");
  assert.strictEqual(checkFinalZip("santa-bighead.zip", 120 * MB), null);
  assert.strictEqual(checkFinalZip("HAT.ZIP", MB), null, "The extension is checked whatever its case");
  assert.match(checkFinalZip("hat.rar", MB) ?? "", /isn't a \.zip/);
  assert.match(checkFinalZip("front.png", MB) ?? "", /isn't a \.zip/);
  assert.match(checkFinalZip("huge.zip", 501 * MB) ?? "", /over the 500 MB limit/);
  console.log("✓ checkFinalZip takes one .zip up to 500 MB");
}

testFinalZipRules();
console.log("✓ All final-zip assertions passed cleanly!");
