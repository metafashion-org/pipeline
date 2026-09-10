import assert from "node:assert";
import { selectDiscordOnboardingCandidates, ONBOARDING_SOURCES, ONBOARDING_STATUSES } from "../onboarding-sync";
import type { OverviewMember } from "@/lib/discord/team-service";

// Which Discord members count as onboarding requests. Getting this wrong in one direction fills
// the review list with people who were onboarded months ago; in the other it hides someone who
// joined the server and is waiting to be let in.

function member(overrides: Partial<OverviewMember> & { id: string }): OverviewMember {
  return {
    username: overrides.id,
    rawUsername: overrides.id,
    displayName: overrides.id,
    roles: [],
    buckets: [],
    channels: [],
    status: "pending",
    ...overrides,
  };
}

function testCandidateSelection() {
  console.log("Verifying which Discord members count as onboarding requests...");

  const members = [
    // Joined the server, no role assigned, unknown to this app: a request.
    member({ id: "new-joiner", displayName: "New Joiner" }),
    // Already carries an "Artist: X" role, so the Discord side of onboarding is done.
    member({ id: "existing-artist", roles: ["Artist: Sanjay"], buckets: ["artist"], status: "active" }),
    // No Discord role, but already a personnel record here — onboarded, just not through Discord.
    member({ id: "linked-person", displayName: "Linked Person" }),
  ];

  const candidates = selectDiscordOnboardingCandidates(members, new Set(["linked-person"]));

  assert.strictEqual(candidates.length, 1, "Only the unassigned, unlinked member is a request");
  assert.strictEqual(candidates[0].id, "new-joiner", "The new joiner is the one waiting to be let in");

  // Once that person is approved, their Discord id is written onto the personnel record, so the
  // next sync must stop treating them as a request.
  const afterApproval = selectDiscordOnboardingCandidates(members, new Set(["linked-person", "new-joiner"]));
  assert.strictEqual(afterApproval.length, 0, "An approved member must not come back as a request");

  // Nobody in the server is a perfectly ordinary state, not an error.
  assert.deepStrictEqual(selectDiscordOnboardingCandidates([], new Set()), [], "An empty guild yields no requests");

  console.log("✓ Discord candidate selection matches the review list's rule");
}

function testConstants() {
  console.log("Verifying the sources and statuses the review list is built on...");

  // Both routes land in the one list. If a third is ever added it belongs here, not in a second table.
  assert.deepStrictEqual([...ONBOARDING_SOURCES], ["email", "discord"], "Both onboarding routes must be represented");

  // A synced request always starts pending: syncing pulls requests in, it never grants access.
  assert.strictEqual(ONBOARDING_STATUSES[0], "pending", "Pending is the status every request starts in");
  assert.ok(ONBOARDING_STATUSES.includes("approved") && ONBOARDING_STATUSES.includes("rejected"), "A request ends approved or rejected");

  console.log("✓ Sources and statuses are what the manual-review flow expects");
}

testCandidateSelection();
testConstants();
console.log("✓ All onboarding sync assertions passed cleanly!");
process.exit(0);
