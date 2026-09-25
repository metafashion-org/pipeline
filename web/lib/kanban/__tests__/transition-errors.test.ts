import assert from "node:assert";
import {
  TransitionRefusedError,
  assetNotFound,
  moveSwitchedOff,
  noSuchStep,
  notYourAsset,
  paymentOrder,
  receiptRequired,
  roleNotAllowed,
  statusNotFound,
  type MoveContext,
  type NextStep,
} from "../transition-errors";

const LABELS = new Map([
  ["assigned", "Assigned"],
  ["in_progress", "In Production"],
  ["in_review", "In Review"],
  ["revisions_requested", "Revisions Requested"],
  ["approved", "Approved"],
  ["final_files_received", "Final Files Received"],
  ["payment_done", "Payment Done"],
]);

const SORT_ORDER: Record<string, number> = {
  assigned: 2,
  in_progress: 3,
  in_review: 4,
  revisions_requested: 5,
  approved: 6,
  final_files_received: 7,
  payment_done: 11,
};

function context(fromKey: string, toKey: string, steps: NextStep[], roles: string[]): MoveContext {
  return {
    from: { key: fromKey, label: LABELS.get(fromKey) as string, sortOrder: SORT_ORDER[fromKey] },
    to: { key: toKey, label: LABELS.get(toKey) as string, sortOrder: SORT_ORDER[toKey] },
    labels: LABELS,
    stepsFromCurrent: steps,
    actorRoles: new Set(roles),
  };
}

const step = (toKey: string, role: string | null, isAutomatic = false, isAllowed = true): NextStep => ({
  toKey,
  role,
  isAutomatic,
  isAllowed,
});

function testMoveBackwards() {
  console.log("Verifying a move backwards names the statuses and says who moves it next...");
  const details = noSuchStep(
    context("in_review", "in_progress", [step("revisions_requested", "operator"), step("approved", "operator")], ["artist"])
  );
  assert.strictEqual(details.code, "NO_SUCH_STEP");
  assert.strictEqual(details.httpStatus, 403);
  assert.strictEqual(details.title, "In Review can't move straight to In Production.");
  assert.strictEqual(details.reason, "Assets don't move backwards on their own.");
  assert.strictEqual(details.hint, "The team moves it to Revisions Requested or Approved.");
}

function testSkippedStep() {
  console.log("Verifying a skipped step lists what the person can move to...");
  const details = noSuchStep(context("assigned", "in_review", [step("in_progress", "artist")], ["artist"]));
  assert.strictEqual(details.code, "NO_SUCH_STEP");
  assert.match(details.reason, /can't be skipped/);
  assert.strictEqual(details.hint, "From Assigned you can move it to In Production.");
}

function testAutomaticMoveAndLastStep() {
  console.log("Verifying automatic moves and the last status are described...");
  const automatic = noSuchStep(context("approved", "in_progress", [step("final_files_received", null, true)], ["artist"]));
  assert.strictEqual(automatic.hint, "It moves to Final Files Received on its own.");

  const last = noSuchStep(context("payment_done", "approved", [], ["artist"]));
  assert.strictEqual(last.hint, "Payment Done is the last step, so there are no further moves.");
}

function testSwitchedOffStepsAreNotSuggested() {
  console.log("Verifying a switched-off move is never offered as a next step...");
  const details = noSuchStep(
    context("assigned", "approved", [step("in_progress", "artist", false, false)], ["artist"])
  );
  assert.strictEqual(details.hint, "Every move out of Assigned is switched off right now.");
}

function testRoleRefusals() {
  console.log("Verifying role refusals explain which role the move belongs to...");
  const ctx = context("in_review", "approved", [step("approved", "operator"), step("revisions_requested", "operator")], ["artist"]);

  const byRule = roleNotAllowed(ctx, { kind: "rule-role", role: "operator" });
  assert.strictEqual(byRule.code, "ROLE_NOT_ALLOWED");
  assert.strictEqual(byRule.title, "You can't move this card from In Review to Approved.");
  assert.strictEqual(byRule.reason, "That move is made by the team.");

  const byColumn = roleNotAllowed(ctx, { kind: "column", roles: ["operator", "admin"] });
  assert.strictEqual(byColumn.reason, "Only the team or an admin can move cards into Approved.");
}

function testPaymentAndReceipt() {
  console.log("Verifying the payment gate and receipt gate messages...");
  const order = paymentOrder(context("approved", "payment_done", [step("final_files_received", null, true)], ["admin"]));
  assert.strictEqual(order.code, "PAYMENT_ORDER");
  assert.strictEqual(order.title, "Payment Done can't be reached from Approved.");
  assert.match(order.reason, /admins included/);

  const receipt = receiptRequired(context("final_files_received", "payment_done", [], ["admin"]));
  assert.strictEqual(receipt.code, "RECEIPT_REQUIRED");
  assert.strictEqual(receipt.title, "Payment Done needs a payment receipt first.");
}

function testSwitchedOffRule() {
  console.log("Verifying a switched-off rule uses its own reason, or a plain default...");
  const ctx = context("assigned", "in_review", [], ["operator"]);
  assert.strictEqual(moveSwitchedOff(ctx, "Reviews are paused this week.").reason, "Reviews are paused this week.");
  assert.strictEqual(moveSwitchedOff(ctx, null).reason, "An admin has turned this move off.");
  assert.strictEqual(moveSwitchedOff(ctx, "   ").reason, "An admin has turned this move off.");
}

function testErrorClass() {
  console.log("Verifying the error carries its code, status and a full message...");
  const notFound = new TransitionRefusedError(assetNotFound());
  assert.strictEqual(notFound.code, "ASSET_NOT_FOUND");
  assert.strictEqual(notFound.httpStatus, 404);

  const unknownStatus = new TransitionRefusedError(statusNotFound("zzz"));
  assert.strictEqual(unknownStatus.httpStatus, 400);
  assert.match(unknownStatus.reason, /"zzz"/);

  const notYours = new TransitionRefusedError(notYourAsset());
  assert.strictEqual(notYours.httpStatus, 403);
  assert.strictEqual(
    notYours.message,
    "You can only move assets assigned to you. This asset isn't assigned to you. If it should be yours, ask the team to assign it to you."
  );
}

testMoveBackwards();
testSkippedStep();
testAutomaticMoveAndLastStep();
testSwitchedOffStepsAreNotSuggested();
testRoleRefusals();
testPaymentAndReceipt();
testSwitchedOffRule();
testErrorClass();
console.log("✓ All move-error message assertions passed cleanly!");
process.exit(0);
