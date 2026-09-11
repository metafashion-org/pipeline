import assert from "node:assert";
import { normalizeFieldOptions, labelForValue } from "../field-options";

// Both shapes below are real rows read out of the live database. form_fields.options is JSONB
// with nothing enforcing its contents: the admin builder writes plain strings, while the
// demo_intake and artifact_submission forms were seeded with {label, value} objects. Rendering
// mapped the column straight into JSX, so an object row threw "Objects are not valid as a React
// child" and took the whole page with it.

function testStringOptions() {
  console.log("Verifying plain string options...");

  const opts = normalizeFieldOptions(["Small", "Medium", "Large"]);
  assert.strictEqual(opts.length, 3, "Three strings must yield three options");
  assert.deepStrictEqual(opts[0], { label: "Small", value: "Small" }, "A string is its own label and value");

  assert.deepStrictEqual(normalizeFieldOptions([" Padded "]), [{ label: "Padded", value: "Padded" }], "Whitespace must be trimmed");

  console.log("✓ String options normalize as themselves");
}

function testObjectOptions() {
  console.log("Verifying {label, value} options...");

  // The exact value stored for demo_intake.size.
  const opts = normalizeFieldOptions([
    { label: "Small", value: "small" },
    { label: "Medium", value: "medium" },
    { label: "Large", value: "large" },
  ]);
  assert.strictEqual(opts.length, 3, "Three objects must yield three options");
  assert.strictEqual(opts[0].label, "Small", "The label is what the person reads");
  assert.strictEqual(opts[0].value, "small", "The value is what gets stored");

  // An option carrying only a display string is still selectable, with the label standing in.
  assert.deepStrictEqual(
    normalizeFieldOptions([{ label: "Reference" }]),
    [{ label: "Reference", value: "Reference" }],
    "A label with no value falls back to the label"
  );

  console.log("✓ Object options keep label and value apart");
}

function testUnrenderableInput() {
  console.log("Verifying input that cannot be rendered...");

  assert.deepStrictEqual(normalizeFieldOptions(null), [], "null is an empty list");
  assert.deepStrictEqual(normalizeFieldOptions(undefined), [], "undefined is an empty list");
  assert.deepStrictEqual(normalizeFieldOptions({}), [], "A non-array is an empty list");
  assert.deepStrictEqual(normalizeFieldOptions([""]), [], "An empty string is not an option");
  assert.deepStrictEqual(normalizeFieldOptions([null, undefined]), [], "Null entries are dropped, not rendered");

  // Radix throws when a SelectItem declares value="", so an option that would produce one is
  // dropped rather than crashing the dropdown it is inside.
  assert.deepStrictEqual(normalizeFieldOptions([{ label: "Blank", value: "" }]), [
    { label: "Blank", value: "Blank" },
  ], "An empty value falls back to the label rather than becoming value=\"\"");

  console.log("✓ Unrenderable entries are dropped");
}

function testDuplicates() {
  console.log("Verifying duplicate handling...");

  // React warned "Encountered two children with the same key, [object Object]" because every
  // object stringified to the same key. Deduplicating on value fixes the underlying collision
  // rather than only the warning.
  const opts = normalizeFieldOptions(["Red", "Red", { label: "Red again", value: "Red" }]);
  assert.strictEqual(opts.length, 1, "The same value must appear once");
  assert.strictEqual(opts[0].label, "Red", "The first occurrence wins");

  console.log("✓ Duplicate values collapse to one option");
}

function testLabelLookup() {
  console.log("Verifying stored-value lookup...");

  const opts = normalizeFieldOptions([{ label: "Medium", value: "medium" }]);
  assert.strictEqual(labelForValue(opts, "medium"), "Medium", "A known value shows its label");
  // A submission recorded under an option that has since been retired still has to display.
  assert.strictEqual(labelForValue(opts, "retired"), "retired", "An unknown value shows itself");

  console.log("✓ Stored values resolve to a label");
}

testStringOptions();
testObjectOptions();
testUnrenderableInput();
testDuplicates();
testLabelLookup();
console.log("✓ All field option assertions passed cleanly!");
