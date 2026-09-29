import assert from "node:assert";
import { pickChannelMember } from "../artist-channel";
import type { DiscordGuildMember } from "../discord-service";

// Discord's VIEW_CHANNEL permission bit, as the string an overwrite carries.
const VIEW = "1024";
const NONE = "0";

function member(id: string, roles: string[], bot = false): DiscordGuildMember {
  return { user: { id, username: id, global_name: null, bot }, nick: null, roles };
}

const ROLES = [
  { id: "role-anuj", name: "Artist: Anuj" },
  { id: "role-admin", name: "Admin" },
  { id: "role-shared", name: "Artist: Shared Team" },
];

function testPickChannelMember() {
  console.log("Verifying an artist channel's owner is found from its Artist role or its one member...");

  // The usual onboarded channel: opened to the artist's own role, the admin role and the bot.
  const onboarded = {
    permission_overwrites: [
      { id: "role-anuj", type: 0 as const, allow: VIEW, deny: NONE },
      { id: "role-admin", type: 0 as const, allow: VIEW, deny: NONE },
    ],
  };
  const members = [member("anuj", ["role-anuj"]), member("boss", ["role-admin"]), member("bot", ["role-anuj"], true)];
  assert.strictEqual(pickChannelMember(onboarded, ROLES, members), "anuj", "The one person holding the channel's Artist role owns it");

  // A temporary access grant adds a member-level overwrite for someone else; the role still decides.
  const withGuest = {
    permission_overwrites: [...onboarded.permission_overwrites, { id: "guest", type: 1 as const, allow: VIEW, deny: NONE }],
  };
  assert.strictEqual(pickChannelMember(withGuest, ROLES, [...members, member("guest", [])]), "anuj");

  // A channel made by hand for one person, with no Artist role.
  const byHand = { permission_overwrites: [{ id: "rishi", type: 1 as const, allow: VIEW, deny: NONE }] };
  assert.strictEqual(pickChannelMember(byHand, ROLES, [member("rishi", [])]), "rishi");

  // A shared role held by several people can't say whose channel it is.
  const shared = { permission_overwrites: [{ id: "role-shared", type: 0 as const, allow: VIEW, deny: NONE }] };
  assert.strictEqual(pickChannelMember(shared, ROLES, [member("a", ["role-shared"]), member("b", ["role-shared"])]), null);

  // An overwrite that denies viewing doesn't count.
  const denied = { permission_overwrites: [{ id: "role-anuj", type: 0 as const, allow: NONE, deny: VIEW }] };
  assert.strictEqual(pickChannelMember(denied, ROLES, members), null);

  console.log("✓ pickChannelMember finds the owner only when exactly one person can be it");
}

testPickChannelMember();
console.log("✓ All artist-channel assertions passed cleanly!");
