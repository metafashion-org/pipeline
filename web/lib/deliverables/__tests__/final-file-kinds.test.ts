import assert from "node:assert";
import { checkFinalFile, checkSubmission } from "../final-file-kinds";

const MB = 1024 * 1024;

function testFileRules() {
  console.log("Verifying each slot takes the file types and sizes the Google Form took...");
  assert.strictEqual(checkFinalFile("images", "front.PNG", 2 * MB), null, "PNG images are accepted, whatever the case");
  assert.strictEqual(checkFinalFile("images", "side.jpeg", 2 * MB), null);
  assert.match(checkFinalFile("images", "model.fbx", MB) ?? "", /has to be \.jpg, \.jpeg, \.png/);
  assert.match(checkFinalFile("images", "huge.png", 11 * MB) ?? "", /over the 10 MB limit/);
  assert.strictEqual(checkFinalFile("model_zip", "hat.zip", 99 * MB), null);
  assert.match(checkFinalFile("model_zip", "hat.rar", MB) ?? "", /has to be \.zip/);
  assert.match(checkFinalFile("motion_pack", "dance.zip", 101 * MB) ?? "", /over the 100 MB limit/);
  console.log("✓ checkFinalFile applies the form's types and limits");
}

function testSubmissionRules() {
  console.log("Verifying a hand-in needs images and the 3D files or a motion pack...");
  assert.strictEqual(checkSubmission([{ kind: "images" }, { kind: "model_zip" }]), null);
  assert.strictEqual(checkSubmission([{ kind: "images" }, { kind: "motion_pack" }]), null, "A motion pack can stand in for the 3D files");
  assert.match(checkSubmission([{ kind: "model_zip" }]) ?? "", /at least one image/);
  assert.match(checkSubmission([{ kind: "images" }]) ?? "", /3D files \.zip, or a motion pack/);
  const sixImages = Array.from({ length: 6 }, () => ({ kind: "images" as const }));
  assert.match(checkSubmission([...sixImages, { kind: "model_zip" }]) ?? "", /up to 5 files/);
  assert.match(checkSubmission([{ kind: "images" }, { kind: "model_zip" }, { kind: "model_zip" }]) ?? "", /one file/);
  console.log("✓ checkSubmission enforces the form's required slots and counts");
}

testFileRules();
testSubmissionRules();
console.log("✓ All final-file-kinds assertions passed cleanly!");
