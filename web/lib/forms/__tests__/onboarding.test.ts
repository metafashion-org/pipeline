import assert from "node:assert";
import {
  ARTIST_ACCESS_FORM_KEY,
  approveArtistAccessSubmission,
  seedOnboardingFormDefinition,
  setPersonnelStatus,
} from "../onboarding";
import { db } from "@/lib/db/client";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, and } from "drizzle-orm";

const TEST_EMAIL = "test-onboarding-approve-flow@example.com";
let submissionId = "";
let personnelId = "";

async function cleanup() {
  if (personnelId) {
    await db.delete(auditLog).where(eq(auditLog.entityId, personnelId));
  }
  if (submissionId) {
    await db.delete(formSubmissions).where(eq(formSubmissions.id, submissionId));
  }
  await db.delete(personnel).where(eq(personnel.email, TEST_EMAIL));
}

function testOnboardingConstants() {
  console.log("Verifying artist onboarding & offboarding constants and rules...");
  assert.strictEqual(ARTIST_ACCESS_FORM_KEY, "artist_access_request", "Onboarding form key must match canonical name");
  console.log("✓ Onboarding form key constant is correct");
}

async function testApproveArtistAccessSubmission() {
  console.log("Verifying approveArtistAccessSubmission() approve-and-provision flow...");

  // Not found -> should throw
  try {
    await approveArtistAccessSubmission("00000000-0000-0000-0000-000000000000");
    assert.fail("Should reject a non-existent submission id");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(message.includes("Submission not found"), `Expected a not-found error, got: ${message}`);
    console.log("Caught expected error for non-existent submission:", message);
  }

  // Real approve flow needs a real form_definitions row to attach to - reuse
  // the actual seeding function rather than hand-rolling a fake definition.
  await seedOnboardingFormDefinition();
  const [def] = await db
    .select()
    .from(formDefinitions)
    .where(eq(formDefinitions.key, ARTIST_ACCESS_FORM_KEY))
    .limit(1);
  assert.ok(def, "Onboarding form definition must exist after seeding");

  await cleanup();
  const [submission] = await db
    .insert(formSubmissions)
    .values({
      formDefinitionId: def.id,
      submitterEmail: TEST_EMAIL,
      values: { fullName: "Test Onboarding Artist", email: TEST_EMAIL },
      status: "pending",
    })
    .returning();
  submissionId = submission.id;

  try {
    const result = await approveArtistAccessSubmission(submissionId, undefined, "approved in test");
    personnelId = result.personnelId;
    assert.strictEqual(result.email, TEST_EMAIL);
    assert.strictEqual(result.status, "Active");

    // Personnel record actually provisioned as Active with the artist role.
    const [p] = await db.select().from(personnel).where(eq(personnel.id, personnelId)).limit(1);
    assert.ok(p, "Personnel record must be created");
    assert.strictEqual(p.status, "Active", "Newly provisioned personnel must be Active");
    assert.ok(p.roles.includes("artist"), "Newly provisioned personnel must have the artist role");
    assert.strictEqual(p.name, "Test Onboarding Artist");

    // Submission itself gets marked approved with review metadata.
    const [sub] = await db.select().from(formSubmissions).where(eq(formSubmissions.id, submissionId)).limit(1);
    assert.strictEqual(sub.status, "approved");
    assert.strictEqual(sub.reviewNotes, "approved in test");
    assert.ok(sub.reviewedAt, "reviewedAt must be set once approved");

    // Audit log entry recorded against the new personnel id.
    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, personnelId), eq(auditLog.action, "approveArtistAccessRequest")))
      .limit(1);
    assert.ok(audit, "approveArtistAccessRequest must be audit-logged");
    assert.strictEqual(audit.entityType, "personnel");

    console.log("Confirmed a fresh submission provisions Active artist personnel with an approval audit entry");

    // Re-approving the same email (e.g. a second access request) must reuse
    // the existing personnel row, merge roles, and force status back to
    // Active rather than creating a duplicate.
    await db.update(personnel).set({ status: "Inactive", roles: ["operator"] }).where(eq(personnel.id, personnelId));
    const [resubmission] = await db
      .insert(formSubmissions)
      .values({
        formDefinitionId: def.id,
        submitterEmail: TEST_EMAIL,
        values: { fullName: "Test Onboarding Artist", email: TEST_EMAIL },
        status: "pending",
      })
      .returning();
    try {
      const secondResult = await approveArtistAccessSubmission(resubmission.id);
      assert.strictEqual(secondResult.personnelId, personnelId, "Re-approval must reuse the existing personnel row, not create a new one");

      const [reactivated] = await db.select().from(personnel).where(eq(personnel.id, personnelId)).limit(1);
      assert.strictEqual(reactivated.status, "Active", "Re-approval must reactivate an Inactive personnel row");
      assert.ok(reactivated.roles.includes("operator"), "Existing roles must be preserved on re-approval");
      assert.ok(reactivated.roles.includes("artist"), "artist role must be merged in on re-approval");
      console.log("Confirmed re-approval reuses the existing personnel row, merges roles, and reactivates status");
    } finally {
      await db.delete(formSubmissions).where(eq(formSubmissions.id, resubmission.id));
    }
  } finally {
    await cleanup();
  }

  console.log("✓ approveArtistAccessSubmission() assertions passed cleanly!");
}

async function testSetPersonnelStatus() {
  console.log("Verifying setPersonnelStatus() status change and audit logging...");

  // Not found -> should throw
  try {
    await setPersonnelStatus("00000000-0000-0000-0000-000000000000", "Inactive");
    assert.fail("Should reject a non-existent personnel id");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(message.includes("Personnel not found"), `Expected a not-found error, got: ${message}`);
    console.log("Caught expected error for non-existent personnel:", message);
  }

  await cleanup();
  const [p] = await db
    .insert(personnel)
    .values({ name: "Test Status Change Personnel", email: TEST_EMAIL, roles: ["artist"], status: "Active" })
    .returning();
  personnelId = p.id;

  try {
    const result = await setPersonnelStatus(personnelId, "Blacklisted", undefined, "policy violation in test");
    assert.strictEqual(result.personnelId, personnelId);
    assert.strictEqual(result.oldStatus, "Active");
    assert.strictEqual(result.newStatus, "Blacklisted");

    const [row] = await db.select().from(personnel).where(eq(personnel.id, personnelId)).limit(1);
    assert.strictEqual(row.status, "Blacklisted", "Status must actually persist in the DB");

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, personnelId), eq(auditLog.action, "changePersonnelStatus")))
      .limit(1);
    assert.ok(audit, "changePersonnelStatus must be audit-logged");
    assert.strictEqual(audit.entityType, "personnel");
    const payload = audit.payload as Record<string, unknown>;
    assert.strictEqual(payload.oldStatus, "Active");
    assert.strictEqual(payload.newStatus, "Blacklisted");
    assert.strictEqual(payload.reason, "policy violation in test");

    console.log("Confirmed status change persists and is audit-logged with old/new status and reason");
  } finally {
    await cleanup();
  }

  console.log("✓ setPersonnelStatus() assertions passed cleanly!");
}

async function main() {
  testOnboardingConstants();
  await testApproveArtistAccessSubmission();
  await testSetPersonnelStatus();
  console.log("✓ All onboarding.ts assertions passed cleanly!");
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
