import assert from "node:assert";
import { getFormDefinitionByKey, submitFormResponse } from "../form-service";
import { ARTIST_ACCESS_FORM_KEY, seedOnboardingFormDefinition, approveArtistAccessSubmission } from "../onboarding";
import { db } from "@/lib/db/client";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";

const TEST_EMAIL = "test-form-service-submission@example.com";
let submissionId = "";
let personnelId = "";

async function cleanup() {
  if (personnelId) await db.delete(auditLog).where(eq(auditLog.entityId, personnelId));
  if (submissionId) await db.delete(formSubmissions).where(eq(formSubmissions.id, submissionId));
  await db.delete(personnel).where(eq(personnel.email, TEST_EMAIL));
}

// The Artist Access Request form had a real, working approval side
// (approveArtistAccessSubmission) but no route or function anywhere that
// could actually create a submission for it to review — a form nobody
// could submit. This walks the real path this round added: fetch the real
// field definitions, submit through submitFormResponse (the function the
// new public /apply page and its API routes actually call), then feed the
// real resulting row into the existing, already-tested approval flow to
// confirm the two ends of this form actually connect.
async function testGetFormDefinitionByKey() {
  console.log("Verifying getFormDefinitionByKey() returns the real seeded form...");
  await seedOnboardingFormDefinition();
  const form = await getFormDefinitionByKey(ARTIST_ACCESS_FORM_KEY);
  assert.ok(form, "Artist Access Request form must be found after seeding");
  assert.ok(form!.fields.length >= 4, "Must return the real seeded fields");
  const keys = form!.fields.map((f) => f.fieldKey);
  assert.ok(keys.includes("fullName") && keys.includes("email"), "Must include the fields approveArtistAccessSubmission depends on");

  const missing = await getFormDefinitionByKey("this-form-key-does-not-exist");
  assert.strictEqual(missing, null, "An unknown form key must return null, not throw");
  console.log("✓ getFormDefinitionByKey() confirmed against the real seeded form");
}

async function testSubmitFormResponseValidation() {
  console.log("Verifying submitFormResponse() rejects missing required fields and strips unknown keys...");
  await cleanup();

  try {
    await submitFormResponse({ formKey: ARTIST_ACCESS_FORM_KEY, values: { notes: "no name or email given" } });
    assert.fail("Should reject a submission missing required fields");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(message.includes("Full Name") && message.includes("Email"), `Expected both missing required fields named, got: ${message}`);
    console.log("Caught expected validation error:", message);
  }

  try {
    await submitFormResponse({ formKey: "this-form-key-does-not-exist", values: {} });
    assert.fail("Should reject submitting to a form that doesn't exist");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(message.includes("not found"), `Expected a not-found error, got: ${message}`);
  }

  console.log("✓ submitFormResponse() validation assertions passed");
}

async function testFullSubmitToApproveFlow() {
  console.log("Verifying a real submitFormResponse() submission flows correctly into the existing approval path...");
  await cleanup();

  try {
    const submission = await submitFormResponse({
      formKey: ARTIST_ACCESS_FORM_KEY,
      values: {
        fullName: "Test Form Service Artist",
        email: TEST_EMAIL,
        portfolioUrl: "https://artstation.com/test-artist",
        notes: "Real background text",
        maliciousExtraField: "should never be stored — not a real field on this form",
      },
    });
    submissionId = submission.id;

    assert.strictEqual(submission.status, "pending");
    assert.strictEqual(submission.submitterEmail, TEST_EMAIL, "submitterEmail must be derived from the email field when not passed explicitly");
    const storedValues = submission.values as Record<string, unknown>;
    assert.strictEqual(storedValues.fullName, "Test Form Service Artist");
    assert.strictEqual(storedValues.portfolioUrl, "https://artstation.com/test-artist");
    assert.strictEqual(
      storedValues.maliciousExtraField,
      undefined,
      "A key that isn't a real declared field on this form must never be stored"
    );

    const [dbRow] = await db.select().from(formSubmissions).where(eq(formSubmissions.id, submissionId)).limit(1);
    assert.ok(dbRow, "A real row must exist in form_submissions");
    assert.strictEqual(dbRow.status, "pending");

    // Now prove the two ends of this form actually connect: feed the real
    // submission this function created into the pre-existing approval flow.
    const approveResult = await approveArtistAccessSubmission(submissionId, undefined, "approved via form-service test");
    personnelId = approveResult.personnelId;
    assert.strictEqual(approveResult.email, TEST_EMAIL);
    assert.strictEqual(approveResult.status, "Active");

    const [p] = await db.select().from(personnel).where(eq(personnel.id, personnelId)).limit(1);
    assert.ok(p, "A real personnel record must be provisioned from the submission this test created");
    assert.strictEqual(p.name, "Test Form Service Artist");
    assert.ok(p.roles.includes("artist"));

    console.log("Confirmed submitFormResponse()'s real output is exactly what approveArtistAccessSubmission expects and provisions correctly");
  } finally {
    await cleanup();
  }

  console.log("✓ Full submit -> approve flow verified against the live DB");
}

async function main() {
  await testGetFormDefinitionByKey();
  await testSubmitFormResponseValidation();
  await testFullSubmitToApproveFlow();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
