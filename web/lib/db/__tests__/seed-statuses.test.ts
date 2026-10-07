import { CANONICAL_STATUSES, CANONICAL_TRANSITION_RULES } from "../seed-statuses";
import assert from "node:assert";

// Self-check test for P2-T3 seed definition
function verifySeedDefinitions() {
  console.log("Verifying CANONICAL_STATUSES count and rules...");
  
  // 1. Must have exactly 12 canonical statuses
  assert.strictEqual(CANONICAL_STATUSES.length, 12, "Should have exactly 12 canonical statuses");

  const keys = CANONICAL_STATUSES.map((s) => s.key);
  const expectedKeys = [
    "unassigned",
    "assigned",
    "in_progress",
    "in_review",
    "revisions_requested",
    "approved",
    "final_files_received",
    "ready_for_upload",
    "uploaded_to_roblox",
    "marked_for_payment",
    "payment_done",
    "put_on_sale",
  ];

  assert.deepStrictEqual(keys, expectedKeys, "Statuses should match canonical keys in order");

  // 2. Verify payment gate rule: marked_for_payment can only come from uploaded_to_roblox
  const paymentRules = CANONICAL_TRANSITION_RULES.filter((r) => r.toStatus === "marked_for_payment");
  assert.strictEqual(paymentRules.length, 1, "Should have exactly one rule into marked_for_payment");
  assert.strictEqual(paymentRules[0].fromStatus, "uploaded_to_roblox", "Payment gate must require uploaded_to_roblox");

  // 3. Put on Sale comes only from Payment Done, and only an admin moves it there.
  const saleRules = CANONICAL_TRANSITION_RULES.filter((r) => r.toStatus === "put_on_sale");
  assert.deepStrictEqual(saleRules.map((r) => [r.fromStatus, r.role]), [["payment_done", "admin"]], "Only an admin moves a paid card to Put on Sale");

  console.log("✓ All status & transition rule assertions passed cleanly!");
}

verifySeedDefinitions();
