import assert from "node:assert";
import { isSelfLockoutAttempt } from "../self-lockout";

// Tests the real guard function imported from lib/auth/self-lockout.ts, which
// app/api/admin/personnel/[personnelId]/status/route.ts also imports and uses
// directly. No hand-retyped copy of the predicate here, so drift between the
// route and this test is impossible by construction.
//
// Root-caused a real live incident: an admin self-set their own row to
// Inactive via the Personnel status dropdown and locked themselves out
// (fixed via direct SQL at the time).

function testSelfLockoutGuard() {
  console.log("Verifying admin self-lockout guard logic...");

  const ADMIN_ID = "admin-personnel-id";
  const OTHER_ID = "other-personnel-id";

  // Self + revoking status -> blocked
  assert.strictEqual(isSelfLockoutAttempt(ADMIN_ID, ADMIN_ID, "Inactive"), true, "Admin setting own row to Inactive must be blocked");
  assert.strictEqual(isSelfLockoutAttempt(ADMIN_ID, ADMIN_ID, "Blacklisted"), true, "Admin setting own row to Blacklisted must be blocked");

  // Self + non-revoking status -> allowed (e.g. re-confirming Active on yourself)
  assert.strictEqual(isSelfLockoutAttempt(ADMIN_ID, ADMIN_ID, "Active"), false, "Admin setting own row to Active must be allowed");

  // Different personnel + revoking status -> allowed (the whole point of the endpoint)
  assert.strictEqual(isSelfLockoutAttempt(ADMIN_ID, OTHER_ID, "Inactive"), false, "Admin revoking someone else must be allowed");
  assert.strictEqual(isSelfLockoutAttempt(ADMIN_ID, OTHER_ID, "Blacklisted"), false, "Admin blacklisting someone else must be allowed");

  // Different personnel + non-revoking status -> allowed
  assert.strictEqual(isSelfLockoutAttempt(ADMIN_ID, OTHER_ID, "Active"), false, "Admin reactivating someone else must be allowed");

  console.log("✓ All self-lockout guard assertions passed cleanly!");
}

testSelfLockoutGuard();
process.exit(0);
