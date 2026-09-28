import assert from "node:assert";
import type { CapabilitySet } from "@/lib/auth/rbac";
import {
  allowedTargets,
  checkMove,
  describeColumn,
  describeNextStep,
  type MoveCard,
  type MoveRule,
  type MoveStatus,
  type TransitionActor,
} from "../move-rules";

// The pipeline as seeded in lib/db/seed-statuses.ts, reduced to what checkMove reads.
const STATUSES: MoveStatus[] = [
  { key: "unassigned", label: "Unassigned", sortOrder: 1, whoCanMoveIn: ["admin", "operator"] },
  { key: "assigned", label: "Assigned", sortOrder: 2, whoCanMoveIn: ["operator", "admin"] },
  { key: "in_progress", label: "In Production", sortOrder: 3, whoCanMoveIn: ["artist", "operator", "admin"] },
  { key: "in_review", label: "In Review", sortOrder: 4, whoCanMoveIn: ["artist", "operator", "admin"] },
  { key: "revisions_requested", label: "Revisions Requested", sortOrder: 5, whoCanMoveIn: ["operator", "admin"] },
  { key: "approved", label: "Approved", sortOrder: 6, whoCanMoveIn: ["operator", "admin"] },
  { key: "final_files_received", label: "Final Files Received", sortOrder: 7, whoCanMoveIn: ["operator", "admin"] },
  { key: "ready_for_upload", label: "Ready for Upload", sortOrder: 8, whoCanMoveIn: ["publisher", "operator", "admin"] },
  { key: "uploaded_to_roblox", label: "Uploaded to Roblox", sortOrder: 9, whoCanMoveIn: ["publisher", "operator", "admin"] },
  { key: "marked_for_payment", label: "Marked for Payment", sortOrder: 10, whoCanMoveIn: ["payment_admin", "admin"] },
  { key: "payment_done", label: "Payment Done", sortOrder: 11, whoCanMoveIn: ["payment_admin", "admin"] },
];

function rule(fromStatus: string, toStatus: string, role: string | null, isAutomatic = false): MoveRule {
  return { fromStatus, toStatus, role, isAllowed: true, isAutomatic, triggerNote: null, failureReason: null };
}

const RULES: MoveRule[] = [
  rule("unassigned", "assigned", null, true),
  rule("assigned", "in_progress", "artist"),
  rule("in_progress", "in_review", "artist"),
  rule("in_review", "approved", "operator"),
  rule("in_review", "revisions_requested", "operator"),
  rule("revisions_requested", "in_progress", "artist"),
  rule("approved", "final_files_received", null, true),
  rule("final_files_received", "ready_for_upload", null, true),
  rule("ready_for_upload", "uploaded_to_roblox", null, true),
  rule("uploaded_to_roblox", "marked_for_payment", "payment_admin"),
  rule("marked_for_payment", "payment_done", "payment_admin"),
];

const NO_CAPS: CapabilitySet = {
  canAssignArtists: false,
  canMoveToInProduction: false,
  canMoveToInReview: false,
  canRequestRevisions: false,
  canApprove: false,
  canAssignPublisher: false,
  canPublishToRoblox: false,
  canMarkForPayment: false,
  canMarkPaymentDone: false,
  canViewAllAssets: false,
  canManageSystemConfig: false,
  canAccessCuratorTools: false,
  canAccessMarketingTools: false,
  canManagePersonnel: false,
};

const ARTIST_ID = "artist-1";
const ARTIST: TransitionActor = { roles: ["artist"], personnelId: ARTIST_ID, caps: NO_CAPS };
const OPERATOR: TransitionActor = { roles: ["operator"], personnelId: "op-1", caps: { ...NO_CAPS, canAssignArtists: true, canViewAllAssets: true } };
const ADMIN: TransitionActor = { roles: ["admin"], personnelId: "admin-1", caps: { ...NO_CAPS, canAssignArtists: true, canViewAllAssets: true, canPublishToRoblox: true } };
// Someone who manages production and also makes assets, like the team lead.
const ARTIST_OPERATOR_PUBLISHER: TransitionActor = {
  roles: ["artist", "operator", "publisher"],
  personnelId: "lead-1",
  caps: { ...NO_CAPS, canAssignArtists: true, canViewAllAssets: true, canPublishToRoblox: true },
};

function card(currentStatus: string, overrides: Partial<MoveCard> = {}): MoveCard {
  return { currentStatus, artistId: ARTIST_ID, offerStatus: "accepted", hasPaymentReceipt: false, ...overrides };
}

function status(key: string): MoveStatus {
  return STATUSES.find((s) => s.key === key) as MoveStatus;
}

function ruleFor(from: string, to: string): MoveRule | undefined {
  return RULES.find((r) => r.fromStatus === from && r.toStatus === to);
}

function testCheckMove() {
  // Unchanged behaviour: an artist moves their own card along their own steps, and not someone else's.
  assert.strictEqual(checkMove(ARTIST, card("in_progress"), status("in_review"), ruleFor("in_progress", "in_review")), null);
  assert.deepStrictEqual(
    checkMove(ARTIST, card("in_progress", { artistId: "someone-else" }), status("in_review"), ruleFor("in_progress", "in_review")),
    { kind: "not-your-asset" }
  );

  // Unchanged: admins may repair records where no rule exists, except into the payment statuses.
  assert.strictEqual(checkMove(ADMIN, card("in_progress"), status("approved"), undefined), null);
  assert.deepStrictEqual(checkMove(ADMIN, card("uploaded_to_roblox"), status("payment_done"), undefined), { kind: "payment-order" });

  // New: an unanswered offer holds the card in Assigned, for admins too.
  const pending = card("assigned", { offerStatus: "pending" });
  assert.deepStrictEqual(checkMove(ARTIST, pending, status("in_progress"), ruleFor("assigned", "in_progress")), { kind: "offer-open" });
  assert.deepStrictEqual(checkMove(ADMIN, pending, status("in_progress"), ruleFor("assigned", "in_progress")), { kind: "offer-open" });
  // Moving it back to Unassigned is still possible, and the system (an accepted offer) is never held.
  assert.strictEqual(checkMove(ADMIN, pending, status("unassigned"), undefined), null);
  assert.strictEqual(checkMove({ system: true }, pending, status("in_progress"), ruleFor("assigned", "in_progress")), null);
  // Once accepted, the artist starts work.
  assert.strictEqual(checkMove(ARTIST, card("assigned"), status("in_progress"), ruleFor("assigned", "in_progress")), null);

  // New: a card reaches Assigned only with an artist on it. The Assign dialog moves it as the system.
  const unassigned = card("unassigned", { artistId: null, offerStatus: null });
  assert.deepStrictEqual(checkMove(OPERATOR, unassigned, status("assigned"), ruleFor("unassigned", "assigned")), { kind: "artist-required" });
  assert.strictEqual(checkMove({ system: true }, unassigned, status("assigned"), ruleFor("unassigned", "assigned")), null);

  console.log("✓ checkMove keeps the old checks and adds the offer and artist gates");
}

function testNextStep() {
  const step = (actor: TransitionActor, c: MoveCard, artistName = "Arjun") => describeNextStep(actor, c, STATUSES, RULES, artistName);

  // Whose turn it is, from each side of an unanswered offer.
  const pending = card("assigned", { offerStatus: "pending" });
  assert.deepStrictEqual(step(ARTIST, pending), { tone: "you", text: "Accept or decline the offer" });
  assert.deepStrictEqual(step(OPERATOR, pending), { tone: "blocked", text: "Waiting for Arjun to accept" });
  assert.deepStrictEqual(step(OPERATOR, card("assigned", { offerStatus: "extension_requested" })), {
    tone: "you",
    text: "Approve or reject the new deadline",
  });

  // The team's step is green for the team and grey for an admin, who may move it but whose job it isn't.
  assert.deepStrictEqual(step(OPERATOR, card("in_review")), { tone: "you", text: "You can move it to Revisions Requested or Approved" });
  assert.deepStrictEqual(step(ADMIN, card("in_review")), { tone: "other", text: "The team moves it on" });

  // An artist step is only yours on your own card, even for a team lead who also has the artist role.
  assert.deepStrictEqual(step(ARTIST_OPERATOR_PUBLISHER, card("in_progress")), { tone: "other", text: "Arjun moves it on" });

  // Moves the pipeline makes when someone acts: said to the person whose job it is, and to everyone else.
  assert.deepStrictEqual(step(OPERATOR, card("unassigned", { artistId: null, offerStatus: null }), ""), { tone: "you", text: "Pick an artist" });
  assert.deepStrictEqual(step(ARTIST, card("approved")), { tone: "you", text: "Upload the final files" });
  assert.deepStrictEqual(step(OPERATOR, card("approved")), { tone: "other", text: "Arjun uploads the final files" });
  assert.deepStrictEqual(step(ARTIST_OPERATOR_PUBLISHER, card("ready_for_upload")), {
    tone: "you",
    text: "Add the Roblox links on the Upload queue",
  });
  assert.deepStrictEqual(step(OPERATOR, card("final_files_received")), { tone: "auto", text: "Moves to Ready for Upload on its own" });

  // A missing receipt holds a card in Marked for Payment.
  assert.deepStrictEqual(step(OPERATOR, card("marked_for_payment")), { tone: "blocked", text: "Needs the payment receipt" });
  assert.deepStrictEqual(step(OPERATOR, card("payment_done")), { tone: "done", text: "Finished" });

  console.log("✓ describeNextStep says whose move each card is");
}

function testColumnsAndDropTargets() {
  const review = describeColumn(OPERATOR, "in_review", STATUSES, RULES);
  assert.deepStrictEqual(review.next, { tone: "you", text: "Next: you" });
  // Listed in board order: Revisions Requested (5) comes before Approved (6).
  assert.deepStrictEqual(
    review.exits.map((e) => `${e.toLabel}:${e.who}`),
    ["Revisions Requested:You", "Approved:You"]
  );
  assert.strictEqual(review.whoCanMoveIn, "The artist, the team or an admin");

  // The team lead sees In Production as the artist's step, not theirs.
  assert.deepStrictEqual(describeColumn(ARTIST_OPERATOR_PUBLISHER, "in_progress", STATUSES, RULES).next, {
    tone: "other",
    text: "Next: the artist",
  });
  // An artist-only viewer sees their own cards, so the artist step is theirs.
  assert.deepStrictEqual(describeColumn(ARTIST, "in_progress", STATUSES, RULES).next, { tone: "you", text: "Next: you" });
  assert.deepStrictEqual(describeColumn(ADMIN, "payment_done", STATUSES, RULES).next, { tone: "done", text: "Last step" });

  // Dropping an unassigned card on Assigned opens the Assign dialog, so it counts as a place it can go.
  const unassigned = card("unassigned", { artistId: null, offerStatus: null });
  assert.ok(allowedTargets(OPERATOR, unassigned, STATUSES, RULES).has("assigned"));
  assert.ok(!allowedTargets(ARTIST, card("in_progress"), STATUSES, RULES).has("approved"));
  assert.deepStrictEqual([...allowedTargets(ARTIST, card("in_progress"), STATUSES, RULES)], ["in_review"]);

  console.log("✓ describeColumn and allowedTargets agree with the rules");
}

testCheckMove();
testNextStep();
testColumnsAndDropTargets();
console.log("✓ All move-rules assertions passed cleanly!");
