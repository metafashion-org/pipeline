import assert from "node:assert";
import { getEffectiveCapabilities } from "../rbac";
import { isAdminAccessChangeByNonAdmin } from "../admin-guard";

// Jayesh's real setup: operator + artist + publisher roles, given canManagePersonnel as an override.
const personnelManager = getEffectiveCapabilities(["artist", "operator", "publisher"], { canManagePersonnel: true });
const admin = getEffectiveCapabilities(["admin"]);

function testPersonnelPermission() {
  console.log("Verifying canManagePersonnel is its own permission...");
  assert.strictEqual(admin.canManagePersonnel, true, "Admins manage personnel by default");
  assert.strictEqual(getEffectiveCapabilities(["operator"]).canManagePersonnel, false, "Operators don't, unless granted it");
  assert.strictEqual(personnelManager.canManagePersonnel, true);
  assert.strictEqual(personnelManager.canManageSystemConfig, false, "Managing personnel must not grant Settings");
}

function testAdminGuard() {
  console.log("Verifying a personnel manager who isn't an admin can't touch admin access...");
  assert.strictEqual(isAdminAccessChangeByNonAdmin(personnelManager, [], ["artist"]), false, "Adding an artist is fine");
  assert.strictEqual(isAdminAccessChangeByNonAdmin(personnelManager, ["artist"], ["artist", "curator"]), false, "Changing a non-admin's roles is fine");
  assert.strictEqual(isAdminAccessChangeByNonAdmin(personnelManager, [], ["admin"]), true, "Creating an admin is refused");
  assert.strictEqual(isAdminAccessChangeByNonAdmin(personnelManager, ["operator"], ["operator", "Admin"]), true, "Promoting to admin is refused, any casing");
  assert.strictEqual(isAdminAccessChangeByNonAdmin(personnelManager, ["admin"]), true, "Deactivating or deleting an admin is refused");
  assert.strictEqual(isAdminAccessChangeByNonAdmin(admin, ["admin"], ["operator"]), false, "An admin can change another admin");
}

testPersonnelPermission();
testAdminGuard();
console.log("✓ All admin guard assertions passed cleanly!");
process.exit(0);
