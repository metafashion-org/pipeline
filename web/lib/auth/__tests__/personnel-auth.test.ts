import assert from "node:assert";
import { getActivePersonnelByEmail } from "../personnel-auth";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { eq } from "drizzle-orm";

// This is the single RBAC gate every login goes through (app/api/auth/[...nextauth]/route.ts
// calls this on every sign-in), so every branch here is a real access-control
// decision, not incidental logic.
const TEST_EMAIL = "test-personnel-auth-gate@example.com";

async function cleanup() {
  await db.delete(personnel).where(eq(personnel.email, TEST_EMAIL));
}

async function testPersonnelAuthLogic() {
  console.log("Verifying personnel DB authentication and status gating logic...");

  // 1. Non-existent email -> denied, no roles leaked
  const ghost = await getActivePersonnelByEmail("ghost.user@nonexistent.domain");
  assert.strictEqual(ghost.isAllowed, false, "Ghost user must not be allowed access");
  assert.deepStrictEqual(ghost.roles, [], "Ghost user roles must be empty");

  // 2. Empty string email -> denied
  const empty = await getActivePersonnelByEmail("");
  assert.strictEqual(empty.isAllowed, false, "Empty email must be denied");

  await cleanup();
  try {
    // 3. Active personnel -> allowed
    await db.insert(personnel).values({
      name: "Test Gate Personnel",
      email: TEST_EMAIL,
      roles: ["artist"],
      status: "Active",
    });
    const active = await getActivePersonnelByEmail(TEST_EMAIL);
    assert.strictEqual(active.isAllowed, true, "Active personnel must be allowed");
    assert.deepStrictEqual(active.roles, ["artist"], "Roles must be returned for an allowed login");

    // Case-insensitive / whitespace-tolerant email match, since the gate normalizes both.
    const activeMixedCase = await getActivePersonnelByEmail(`  ${TEST_EMAIL.toUpperCase()}  `);
    assert.strictEqual(activeMixedCase.isAllowed, true, "Email match must be case/whitespace-insensitive");

    // 4. Inactive personnel -> denied
    await db.update(personnel).set({ status: "Inactive" }).where(eq(personnel.email, TEST_EMAIL));
    const inactive = await getActivePersonnelByEmail(TEST_EMAIL);
    assert.strictEqual(inactive.isAllowed, false, "Inactive personnel must be denied");
    assert.strictEqual(inactive.status, "Inactive", "Denied result should still report the real status");

    // 5. Blacklisted personnel -> denied
    await db.update(personnel).set({ status: "Blacklisted" }).where(eq(personnel.email, TEST_EMAIL));
    const blacklisted = await getActivePersonnelByEmail(TEST_EMAIL);
    assert.strictEqual(blacklisted.isAllowed, false, "Blacklisted personnel must be denied");
    assert.strictEqual(blacklisted.status, "Blacklisted", "Denied result should still report the real status");
  } finally {
    await cleanup();
  }

  // 6. DB-error path -> fail-safe (denied), not fail-open. A null byte is invalid
  // UTF8 for Postgres and reliably triggers a real query-level driver error
  // (PostgresError 22021), exercising the actual try/catch fail-safe branch
  // against the live DB rather than a mocked failure.
  const poisoned = "bad" + String.fromCharCode(0) + "email@example.com";
  const errored = await getActivePersonnelByEmail(poisoned);
  assert.strictEqual(errored.isAllowed, false, "A DB error during the lookup must deny access, not throw or allow");
  assert.deepStrictEqual(errored.roles, [], "A DB error during the lookup must not leak any roles");

  console.log("✓ All personnel-auth RBAC gate assertions passed cleanly (allowed/denied/missing/DB-error fail-safe)!");
}

testPersonnelAuthLogic()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
