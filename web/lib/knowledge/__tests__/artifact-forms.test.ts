import assert from "node:assert";
import { ARTIFACT_FORMS, formForPrefix, parseArtifactSubmission } from "../artifact-forms";

function testEachFormHasATitleAndUniqueKeys() {
  console.log("Verifying every type's form has a required title and no repeated field...");
  for (const form of ARTIFACT_FORMS) {
    const title = form.fields.find((f) => f.column === "title");
    assert.ok(title?.required, `${form.prefix} must ask for a title`);
    const keys = form.fields.map((f) => f.key);
    assert.strictEqual(new Set(keys).size, keys.length, `${form.prefix} repeats a field key`);
  }
  console.log("Confirmed every form has a required title and unique keys");
}

function testRetiredTypesHaveNoForm() {
  console.log("Verifying Marketing Insight, Reference and Test Data have no form of their own...");
  for (const prefix of ["MKT", "REF", "TEST"]) {
    assert.ok(!ARTIFACT_FORMS.some((f) => f.prefix === prefix), `${prefix} is retired and must not have a form`);
  }
  console.log("Confirmed the retired types have no form");
}

function testInsightSortsValuesIntoColumnsAndDetails() {
  console.log("Verifying an insight's values land in their columns and details, and extra keys are dropped...");
  const result = parseArtifactSubmission(formForPrefix("INS"), {
    title: "  Emissive items are available ",
    description: "Eligible creators can sell emissive items.",
    seenOn: "2026-09-02",
    fileUrl: "https://devforum.roblox.com/t/example/1",
    attachments: [{ url: "https://drive.google.com/file/d/abcdefghijk/view", name: "screenshot.png" }],
    usageNotes: "Test glow accents first.",
    source: "not a field on insights",
    somethingElse: "dropped",
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  const { submission } = result;
  assert.strictEqual(submission.title, "Emissive items are available", "Text is trimmed");
  assert.strictEqual(submission.fileUrl, "https://devforum.roblox.com/t/example/1");
  assert.strictEqual(submission.usageNotes, "Test glow accents first.");
  assert.deepStrictEqual(submission.details, {
    seenOn: "2026-09-02",
    attachments: [{ url: "https://drive.google.com/file/d/abcdefghijk/view", name: "screenshot.png" }],
  });
  assert.strictEqual(submission.source, undefined, "A field the type doesn't have is dropped");
  console.log("Confirmed the insight's values were sorted and the extras dropped");
}

function testRequiredAndInvalidValuesAreRefused() {
  console.log("Verifying missing required fields and bad values are refused with the field's label...");
  const noText = parseArtifactSubmission(formForPrefix("INS"), { title: "Headline only" });
  assert.deepStrictEqual(noText, { ok: false, error: "The insight is required" });

  const badLink = parseArtifactSubmission(formForPrefix("CD"), { title: "Doc", fileUrl: "docs.google.com/xyz" });
  assert.ok(!badLink.ok && badLink.error.startsWith("Doc link"), "A link without http(s) is refused");

  const badDate = parseArtifactSubmission(formForPrefix("INS"), { title: "T", description: "D", seenOn: "2 Sep" });
  assert.ok(!badDate.ok && badDate.error.startsWith("Date seen"), "A date that isn't YYYY-MM-DD is refused");

  const badTrend = parseArtifactSubmission(formForPrefix("MBD"), { title: "Board", fileUrl: "https://pinterest.com/x", trendArtifactId: "TR006" });
  assert.ok(!badTrend.ok && badTrend.error.startsWith("Trend it came from"), "A trend must be picked by its row id");
  console.log("Confirmed missing and invalid values are refused");
}

function testPromptKeepsFileNotes() {
  console.log("Verifying a prompt keeps each input file's note in details...");
  const result = parseArtifactSubmission(formForPrefix("PRM"), {
    title: "Market assessment",
    description: "Analyse the attached bestseller snapshots.",
    chatLink: "https://chatgpt.com/share/abc",
    inputs: [{ url: "https://drive.google.com/file/d/abcdefghijk/view", name: "bestsellers.csv", note: "Top 500 on Sep 20" }],
    fileUrl: "https://docs.google.com/document/d/output",
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.deepStrictEqual(result.submission.details, {
    chatLink: "https://chatgpt.com/share/abc",
    inputs: [{ url: "https://drive.google.com/file/d/abcdefghijk/view", name: "bestsellers.csv", note: "Top 500 on Sep 20" }],
  });
  assert.strictEqual(result.submission.fileUrl, "https://docs.google.com/document/d/output", "The output link is the artifact's link");
  console.log("Confirmed the prompt's chat link and file notes are kept");
}

function testUnknownTypeGetsTheShortForm() {
  console.log("Verifying a type added in Settings gets the short general form...");
  const form = formForPrefix("NEWTYPE");
  assert.deepStrictEqual(
    form.fields.map((f) => f.key),
    ["title", "description", "fileUrl", "usageNotes", "tags"]
  );
  const result = parseArtifactSubmission(form, { title: "Anything", tags: ["a", "b"] });
  assert.ok(result.ok && result.submission.tags?.length === 2);
  console.log("Confirmed the general form applies to unknown types");
}

testEachFormHasATitleAndUniqueKeys();
testRetiredTypesHaveNoForm();
testInsightSortsValuesIntoColumnsAndDetails();
testRequiredAndInvalidValuesAreRefused();
testPromptKeepsFileNotes();
testUnknownTypeGetsTheShortForm();
console.log("✓ All artifact form assertions passed!");
