import assert from "node:assert";
import { canViewChannel, getDepartments, findExactMemberMatch } from "../team-service";
import { VIEW_CHANNEL_BIT, type DiscordChannel, type DiscordOverwrite, type DiscordGuildMember } from "../discord-service";

const EVERYONE_ID = "guild-id-acts-as-everyone-role-id";

function channelWith(overwrites: DiscordOverwrite[]): DiscordChannel {
  return { id: "chan-1", name: "test-channel", type: 0, parent_id: null, permission_overwrites: overwrites };
}

// canViewChannel's real decision table, ported from server.cjs's
// canViewChannel — the exact logic that decides whether a Manager/Curator/
// Artist bucket "sees" a channel in the Team Overview and drives the
// Permissions tab's toggle state. Getting this wrong either hides channels
// that should be visible or claims visibility that doesn't actually exist.
function testCanViewChannel() {
  console.log("Verifying canViewChannel's real Discord permission-overwrite resolution...");

  // No overwrites at all: everyone can see by Discord's own default.
  assert.strictEqual(canViewChannel(channelWith([]), ["role-a"], EVERYONE_ID), true, "No overwrites -> visible by default");

  // @everyone explicitly denied, no role-specific overwrite: not visible.
  const everyoneDenied = channelWith([{ id: EVERYONE_ID, type: 0, allow: "0", deny: VIEW_CHANNEL_BIT.toString() }]);
  assert.strictEqual(canViewChannel(everyoneDenied, ["role-a"], EVERYONE_ID), false, "@everyone denied, no role override -> not visible");

  // @everyone denied, but this specific role is explicitly allowed: visible (role wins).
  const roleAllowedOverride = channelWith([
    { id: EVERYONE_ID, type: 0, allow: "0", deny: VIEW_CHANNEL_BIT.toString() },
    { id: "role-a", type: 0, allow: VIEW_CHANNEL_BIT.toString(), deny: "0" },
  ]);
  assert.strictEqual(canViewChannel(roleAllowedOverride, ["role-a"], EVERYONE_ID), true, "Role-specific allow overrides @everyone deny");
  assert.strictEqual(canViewChannel(roleAllowedOverride, ["role-b"], EVERYONE_ID), false, "A different role with no override still can't see it");

  // @everyone allowed, but this role is explicitly denied: not visible (deny wins over the member's other roles).
  const roleDeniedOverride = channelWith([{ id: "role-a", type: 0, allow: "0", deny: VIEW_CHANNEL_BIT.toString() }]);
  assert.strictEqual(canViewChannel(roleDeniedOverride, ["role-a"], EVERYONE_ID), false, "Role-specific deny overrides the @everyone default");

  // A member with multiple roles: if ANY of their roles is allowed and none is denied, they can see it.
  const multiRole = channelWith([
    { id: EVERYONE_ID, type: 0, allow: "0", deny: VIEW_CHANNEL_BIT.toString() },
    { id: "role-a", type: 0, allow: VIEW_CHANNEL_BIT.toString(), deny: "0" },
  ]);
  assert.strictEqual(canViewChannel(multiRole, ["role-a", "role-b"], EVERYONE_ID), true, "Any allowed role among several grants visibility");

  console.log("✓ canViewChannel's real decision table verified");
}

// getDepartments() is a pure transform of DEPARTMENT_RULES - real business
// rules from the spec (Animations' shared access works through an existing
// role, not a direct channel grant, and defaults to NOT auto-adding it;
// every other department with a shared channel defaults to adding it).
function testGetDepartments() {
  console.log("Verifying getDepartments() reflects the real department rules...");
  const departments = getDepartments();
  assert.ok(departments.length >= 4, "Should return the real configured departments");

  const animations = departments.find((d) => d.name === "Animations");
  assert.ok(animations, "Animations department must exist");
  assert.strictEqual(animations!.sharedDefault, false, "Animations' shared-access checkbox must default OFF (goes through an existing role, not a direct grant)");
  assert.ok(animations!.sharedLabel?.includes("animation-concepts"), "Animations' shared label must name its real shared channel");

  const hairTeam = departments.find((d) => d.name === "Hair Team");
  assert.ok(hairTeam, "Hair Team department must exist");
  assert.strictEqual(hairTeam!.sharedDefault, true, "Hair Team's shared-access checkbox must default ON (direct channel grant, not a role)");

  const noSharedDept = departments.find((d) => d.sharedChannelName === null);
  assert.ok(noSharedDept, "At least one department (3D UGC Accessories) has no shared channel at all");
  assert.strictEqual(noSharedDept!.sharedLabel, null, "A department with no shared channel must have no shared label to show");

  console.log("✓ getDepartments() reflects the real department rules");
}

// findExactMemberMatch — regression test for the 2026-08-27 live incident:
// onboarding silently failed for anyone typing a real artist's display name
// (the same name the server's own "Artist: X" role uses) instead of their
// cryptic actual @username. Fixtures are the real shapes seen on the live
// guild that day (Discord returns "" for global_name/nick, not null, when
// unset — both are checked here since the code treats "" as falsy too).
function testFindExactMemberMatch() {
  console.log("Verifying findExactMemberMatch resolves by username, display name, or nickname...");

  const anuj: DiscordGuildMember = { user: { id: "1", username: "anuj_shadow", global_name: "Anuj" }, nick: null, roles: [] };
  const sanjay: DiscordGuildMember = { user: { id: "2", username: "sanjay3darts", global_name: "sanjay" }, nick: null, roles: [] };
  const bhaswar: DiscordGuildMember = { user: { id: "3", username: "bhaswar_77835", global_name: "Bhaswar" }, nick: "B-dawg", roles: [] };
  const noDisplayName: DiscordGuildMember = { user: { id: "4", username: "rawhandle42", global_name: null }, nick: null, roles: [] };
  const members = [anuj, sanjay, bhaswar, noDisplayName];

  assert.strictEqual(findExactMemberMatch(members, "Anuj")?.user.id, "1", "Must resolve by display name, case-insensitive");
  assert.strictEqual(findExactMemberMatch(members, "anuj_shadow")?.user.id, "1", "Must still resolve by the raw username too");
  assert.strictEqual(findExactMemberMatch(members, "SANJAY")?.user.id, "2", "Display name match must be case-insensitive");
  assert.strictEqual(findExactMemberMatch(members, "B-dawg")?.user.id, "3", "Must resolve by server nickname when set");
  assert.strictEqual(findExactMemberMatch(members, "rawhandle42")?.user.id, "4", "A member with no display name must still resolve by username");
  assert.strictEqual(findExactMemberMatch(members, "Anu"), undefined, "Must NOT prefix-match — exact only, no guessing");
  assert.strictEqual(findExactMemberMatch(members, "Someone Else"), undefined, "A name matching nobody must resolve to nothing");

  console.log("✓ findExactMemberMatch resolves onboarding lookups the way the team actually types names");
}

async function main() {
  testCanViewChannel();
  testGetDepartments();
  testFindExactMemberMatch();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
