import assert from "node:assert";
import { isSelfLockoutAttempt, isSelfAdminRemovalAttempt } from "../self-lockout";

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

function testSelfAdminRemovalGuard() {
  console.log("Verifying admin self-role-removal guard logic...");

  const ADMIN_ID = "admin-personnel-id";
  const OTHER_ID = "other-personnel-id";

  // Self + dropping admin from own roles -> blocked
  assert.strictEqual(isSelfAdminRemovalAttempt(ADMIN_ID, ADMIN_ID, ["operator"]), true, "Admin removing admin from own roles must be blocked");

  // Self + keeping admin among other roles -> allowed
  assert.strictEqual(isSelfAdminRemovalAttempt(ADMIN_ID, ADMIN_ID, ["admin", "operator"]), false, "Admin keeping admin in own roles must be allowed");

  // Different personnel + dropping admin -> allowed (the whole point of the endpoint)
  assert.strictEqual(isSelfAdminRemovalAttempt(ADMIN_ID, OTHER_ID, ["operator"]), false, "Admin demoting someone else must be allowed");

  console.log("✓ All self-admin-removal guard assertions passed cleanly!");
}

testSelfLockoutGuard();
testSelfAdminRemovalGuard();
process.exit(0);
