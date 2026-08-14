import assert from "node:assert";
import { getEffectiveCapabilities, isRouteAllowedForRoles, ROLE_DEFAULT_CAPABILITIES } from "../rbac";

function testRbacSystem() {
  console.log("Verifying 7-Role RBAC Capability & Route Guard logic...");

  // 1. Verify all 7 roles exist in default mapping
  const expectedRoles = ["admin", "operator", "curator", "artist", "publisher", "marketing", "payment_admin"];
  for (const role of expectedRoles) {
    assert.ok(ROLE_DEFAULT_CAPABILITIES[role as keyof typeof ROLE_DEFAULT_CAPABILITIES], `Role ${role} must exist`);
  }

  // 2. Admin should have all capabilities
  const adminCaps = getEffectiveCapabilities(["admin"]);
  for (const cap in adminCaps) {
    assert.strictEqual(adminCaps[cap as keyof typeof adminCaps], true, `Admin must have ${cap}`);
  }

  // 3. Multi-role union (Artist + Publisher)
  const artistPublisherCaps = getEffectiveCapabilities(["artist", "publisher"]);
  assert.strictEqual(artistPublisherCaps.canMoveToInProduction, true, "Should have artist capability");
  assert.strictEqual(artistPublisherCaps.canPublishToRoblox, true, "Should have publisher capability");
  assert.strictEqual(artistPublisherCaps.canMarkForPayment, false, "Should not have payment capability");

  // 4. Per-person capability override widening (Artist granted canApprove)
  const widenedArtist = getEffectiveCapabilities(["artist"], { canApprove: true });
  assert.strictEqual(widenedArtist.canApprove, true, "Override should widen artist capability to approve");

  // 5. Per-person capability override narrowing (Operator revoked canAssignArtists)
  const narrowedOperator = getEffectiveCapabilities(["operator"], { canAssignArtists: false });
  assert.strictEqual(narrowedOperator.canAssignArtists, false, "Override should narrow operator capability");

  // 6. Route guards
  assert.strictEqual(isRouteAllowedForRoles("/admin", ["admin"]), true);
  assert.strictEqual(isRouteAllowedForRoles("/admin", ["artist"]), false);
  assert.strictEqual(isRouteAllowedForRoles("/artist", ["artist"]), true);
  assert.strictEqual(isRouteAllowedForRoles("/publisher", ["publisher"]), true);

  // 7. Unlisted pathname defaults open (documented, intentional behavior, not a silent accident)
  assert.strictEqual(isRouteAllowedForRoles("/some-other-page", ["artist"]), true, "Unlisted route must default to allowed");

  // 8. Unrecognized role string contributes no capabilities and doesn't throw
  const bogusRoleCaps = getEffectiveCapabilities(["not-a-real-role"]);
  for (const cap in bogusRoleCaps) {
    assert.strictEqual(bogusRoleCaps[cap as keyof typeof bogusRoleCaps], false, `Unrecognized role must not grant ${cap}`);
  }

  // 9. Non-boolean override value is ignored, not applied
  const badOverrideCaps = getEffectiveCapabilities(["artist"], { canApprove: "true" as unknown as boolean });
  assert.strictEqual(badOverrideCaps.canApprove, false, "Non-boolean override must be ignored, not applied");

  console.log("✓ All P2-T6 7-Role RBAC assertions passed cleanly!");
}

testRbacSystem();
