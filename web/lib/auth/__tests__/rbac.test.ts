import assert from "node:assert";
import { getEffectiveCapabilities, isRouteAllowedForRoles, landingPathForRoles, ROLE_DEFAULT_CAPABILITIES } from "../rbac";

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

  // 10. "uploader" is a live personnel.roles value not in SystemRole; it must alias to publisher's capabilities
  const uploaderCaps = getEffectiveCapabilities(["uploader"]);
  assert.strictEqual(uploaderCaps.canPublishToRoblox, true, "uploader must alias to publisher's canPublishToRoblox");

  // 11. Real-world multi-role union from the live DB (Jayesh Singh: artist, operator, uploader)
  const jayeshCaps = getEffectiveCapabilities(["artist", "operator", "uploader"]);
  assert.strictEqual(jayeshCaps.canMoveToInProduction, true, "Should union in artist capability");
  assert.strictEqual(jayeshCaps.canAssignArtists, true, "Should union in operator capability");
  assert.strictEqual(jayeshCaps.canPublishToRoblox, true, "Should union in aliased uploader capability");

  // 12. /publisher route must also admit the raw "uploader" role string, not just the capability
  assert.strictEqual(isRouteAllowedForRoles("/publisher", ["uploader"]), true, "uploader must be allowed on /publisher route");

  // This function now gates the real page routes (proxy.ts), so these are load-bearing.

  // Admin subsections need more than "can see the board". An operator runs production day to
  // day and belongs on the board, but managing people and rewriting the status machine is a
  // higher bar, and payment_admin holds canViewAllAssets without being an administrator.
  assert.strictEqual(isRouteAllowedForRoles("/admin", ["operator"]), true, "operator belongs on the admin board");
  assert.strictEqual(isRouteAllowedForRoles("/admin/personnel", ["operator"]), false, "operator must not manage personnel");
  assert.strictEqual(isRouteAllowedForRoles("/admin/settings", ["operator"]), false, "operator must not edit system config");
  assert.strictEqual(isRouteAllowedForRoles("/admin/personnel", ["admin"]), true, "admin manages personnel");
  assert.strictEqual(isRouteAllowedForRoles("/admin", ["payment_admin"]), true, "payment_admin can view all assets");
  assert.strictEqual(isRouteAllowedForRoles("/admin/settings", ["payment_admin"]), false, "payment_admin is not a system administrator");

  // The marketing role reaching its own tools. It could not before: the session's collapsed
  // role string never produced "marketing", so every check against it was dead.
  assert.strictEqual(isRouteAllowedForRoles("/admin/marketing", ["marketing"]), true, "marketing must reach marketing tools");
  assert.strictEqual(isRouteAllowedForRoles("/admin/marketing", ["artist"]), false, "an artist must not reach marketing tools");

  // Per-person overrides have to actually change what a page route allows — that is the whole
  // reason personnel.capability_overrides exists, and the previous middleware ignored it.
  assert.strictEqual(
    isRouteAllowedForRoles("/admin/settings", ["artist"], { canManageSystemConfig: true }),
    true,
    "a granted override must widen route access"
  );
  assert.strictEqual(
    isRouteAllowedForRoles("/admin", ["operator"], { canViewAllAssets: false, canManageSystemConfig: false }),
    false,
    "a revoked override must narrow route access"
  );

  // Roles arrive capitalised from the source personnel sheet ("Artist, Operator, Uploader").
  assert.strictEqual(isRouteAllowedForRoles("/artist", ["Artist"]), true, "role matching must be case-insensitive");

  // Everyone lands somewhere they can use. A pure marketing or payment_admin person used to
  // fall through every branch of the login redirect and sit on "/" with no error.
  assert.strictEqual(landingPathForRoles(["artist"]), "/artist");
  assert.strictEqual(landingPathForRoles(["curator"]), "/curator");
  assert.strictEqual(landingPathForRoles(["publisher"]), "/publisher");
  assert.strictEqual(landingPathForRoles(["payment_admin"]), "/admin");
  assert.strictEqual(landingPathForRoles([]), "/unauthorized", "someone with no roles has nowhere to land");

  console.log("✓ All P2-T6 7-Role RBAC assertions passed cleanly!");
}

testRbacSystem();
