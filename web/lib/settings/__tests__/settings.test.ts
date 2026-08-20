import assert from "node:assert";
import { listStatuses, upsertStatus, listTransitionRules, upsertTransitionRule } from "../settings-service";
import { db } from "@/lib/db/client";
import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitionRules } from "@/lib/db/schema/status_transition_rules";
import { eq, and } from "drizzle-orm";

// Uses clearly-marked test keys and cleans them up itself - other agents are
// writing to these same live shared tables concurrently this session, so
// this avoids both leaving junk rows behind and relying on total-row-count
// deltas that a concurrent writer elsewhere could make flaky.
const TEST_STATUS_KEY = "__p3_t11_test_status__";
const TEST_FROM_KEY = "__p3_t11_test_from__";
const TEST_TO_KEY = "__p3_t11_test_to__";

async function testStatusUpsertIsIdempotentAndLive() {
  await upsertStatus({ key: TEST_STATUS_KEY, label: "Test Status", sortOrder: 999, nextActionHint: "hint v1" });
  const afterInsert = await listStatuses();
  const inserted = afterInsert.filter((s) => s.key === TEST_STATUS_KEY);
  assert.strictEqual(inserted.length, 1, "Expected exactly one row for the test status key after insert");

  // Second call with the same key updates in place, doesn't duplicate.
  await upsertStatus({ key: TEST_STATUS_KEY, label: "Test Status", sortOrder: 999, nextActionHint: "hint v2" });
  const afterUpdate = await listStatuses();
  const updatedRows = afterUpdate.filter((s) => s.key === TEST_STATUS_KEY);
  assert.strictEqual(updatedRows.length, 1, "upsertStatus with the same key must not create a duplicate row");
  assert.strictEqual(updatedRows[0].nextActionHint, "hint v2", "Second upsert should have updated the existing row's field");

  console.log("✓ upsertStatus: idempotent by key, changes reflected live");
}

async function testTransitionRuleUpsertIsIdempotentAndLive() {
  await upsertTransitionRule({ fromStatus: TEST_FROM_KEY, toStatus: TEST_TO_KEY, role: "admin", triggerNote: "v1" });
  const afterInsert = await listTransitionRules();
  const inserted = afterInsert.filter((r) => r.fromStatus === TEST_FROM_KEY && r.toStatus === TEST_TO_KEY);
  assert.strictEqual(inserted.length, 1, "Expected exactly one row for the test rule after insert");

  await upsertTransitionRule({ fromStatus: TEST_FROM_KEY, toStatus: TEST_TO_KEY, role: "admin", triggerNote: "v2" });
  const afterUpdate = await listTransitionRules();
  const updatedRows = afterUpdate.filter((r) => r.fromStatus === TEST_FROM_KEY && r.toStatus === TEST_TO_KEY);
  assert.strictEqual(updatedRows.length, 1, "upsertTransitionRule with the same from/to must not duplicate");
  assert.strictEqual(updatedRows[0].triggerNote, "v2", "Second upsert should have updated the existing row's field");

  console.log("✓ upsertTransitionRule: idempotent by (fromStatus, toStatus), changes reflected live");
}

async function cleanup() {
  await db.delete(statuses).where(eq(statuses.key, TEST_STATUS_KEY));
  await db
    .delete(statusTransitionRules)
    .where(and(eq(statusTransitionRules.fromStatus, TEST_FROM_KEY), eq(statusTransitionRules.toStatus, TEST_TO_KEY)));
}

async function main() {
  try {
    await testStatusUpsertIsIdempotentAndLive();
    await testTransitionRuleUpsertIsIdempotentAndLive();
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err.message);
    process.exit(1);
  });
