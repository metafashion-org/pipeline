import assert from "node:assert";
import { validateFormValues, FormFieldConfig } from "../form-engine";

function testFormEngineValidation() {
  console.log("Verifying Form Engine validation rules...");

  const testFields: FormFieldConfig[] = [
    {
      id: "f1",
      fieldKey: "fullName",
      label: "Full Name",
      fieldType: "text",
      sortOrder: 1,
      isRequired: true,
      options: [],
      validationRules: {},
    },
    {
      id: "f2",
      fieldKey: "portfolioUrl",
      label: "Portfolio Link",
      fieldType: "url",
      sortOrder: 2,
      isRequired: true,
      options: [],
      validationRules: {},
    },
  ];

  // 1. Valid submission
  const valid = validateFormValues(testFields, {
    fullName: "Jane Doe",
    portfolioUrl: "https://example.com/portfolio",
  });
  assert.strictEqual(valid.isValid, true, "Valid payload should pass");

  // 2. Missing required field
  const missing = validateFormValues(testFields, {
    portfolioUrl: "https://example.com/portfolio",
  });
  assert.strictEqual(missing.isValid, false, "Missing required field should fail");
  assert.ok(missing.errors.fullName, "Should have error for fullName");

  // 3. Invalid URL format
  const invalidUrl = validateFormValues(testFields, {
    fullName: "Jane Doe",
    portfolioUrl: "invalid-url-string",
  });
  assert.strictEqual(invalidUrl.isValid, false, "Invalid URL format should fail");
  assert.ok(invalidUrl.errors.portfolioUrl, "Should have error for portfolioUrl");

  console.log("✓ All Form Engine validation assertions passed cleanly!");
}

testFormEngineValidation();
