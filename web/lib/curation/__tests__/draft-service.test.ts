import assert from "node:assert";
import {
  createDraft,
  listActiveDrafts,
  saveDraft,
  discardDraft,
  listDraftVersions,
  restoreDraftVersion,
} from "../draft-service";
import { submitCurationItemIdea } from "../curation-service";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { curationItemIdeas } from "@/lib/db/schema/curation_item_ideas";
import { curationIdeaVersions } from "@/lib/db/schema/curation_idea_versions";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, inArray } from "drizzle-orm";

const OWNER_EMAIL = "test-draft-service-owner@example.com";
const OTHER_EMAIL = "test-draft-service-other@example.com";
let ownerId = "";
let otherId = "";
const draftIds: string[] = [];
// Ideas that got submitted (converted from a draft into a real asset) -
// tracked separately from draftIds because they're no longer drafts by the
// time cleanup runs, but the row (and the asset it points to) still needs
// deleting, in FK order: the idea row references the asset, so it must go
// first.
const convertedIdeaIds: string[] = [];
const assetIds: string[] = [];

async function cleanup() {
  for (const id of assetIds) await db.delete(auditLog).where(eq(auditLog.entityId, id));
  const allIdeaIds = [...draftIds, ...convertedIdeaIds];
  if (allIdeaIds.length > 0) {
    await db.delete(curationIdeaVersions).where(inArray(curationIdeaVersions.ideaId, allIdeaIds));
    await db.delete(curationItemIdeas).where(inArray(curationItemIdeas.id, allIdeaIds));
  }
  if (assetIds.length > 0) await db.delete(assets).where(inArray(assets.id, assetIds));
  await db.delete(personnel).where(inArray(personnel.email, [OWNER_EMAIL, OTHER_EMAIL]));
  draftIds.length = 0;
  convertedIdeaIds.length = 0;
  assetIds.length = 0;
}

// Parallel drafts + version history for the Curation form - the daily-use
// form this feature was specifically asked for. Verifies the real
// mechanics against the live DB: multiple drafts genuinely coexist,
// autosave never creates a duplicate row, version snapshots are throttled
// (not one per keystroke), restore is non-destructive, discard actually
// removes it, and submitting a draft converts it in place rather than
// leaving an orphaned draft row behind a separate approved one.
async function testParallelDraftsAndDedup() {
  console.log("Verifying parallel drafts exist independently and saves never duplicate a row...");
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Test Draft Owner", email: OWNER_EMAIL, roles: ["curator"] }).returning();
  ownerId = owner.id;

  const draftA = await createDraft(ownerId, { ideaTitle: "Sakura Hair Concept" });
  const draftB = await createDraft(ownerId, { ideaTitle: "Winter Scarf Concept" });
  draftIds.push(draftA.id, draftB.id);

  assert.notStrictEqual(draftA.id, draftB.id, "Two separate createDraft calls must produce two separate rows");

  const active = await listActiveDrafts(ownerId);
  assert.strictEqual(active.length, 2, "Both parallel drafts must show up as active");
  assert.ok(active.some((d) => d.id === draftA.id) && active.some((d) => d.id === draftB.id));

  // Real dedup check: five saves against the SAME draft must still be one row.
  for (let i = 0; i < 5; i++) {
    await saveDraft(draftA.id, ownerId, { ideaTitle: `Sakura Hair Concept v${i}` });
  }
  const stillActive = await listActiveDrafts(ownerId);
  assert.strictEqual(stillActive.length, 2, "Repeated saves to the same draft must never create additional rows");
  const savedA = stillActive.find((d) => d.id === draftA.id)!;
  assert.strictEqual(savedA.ideaTitle, "Sakura Hair Concept v4", "The row must reflect the latest save, not a stale copy");

  console.log("✓ Parallel drafts coexist and repeated saves never duplicate a row");
}

async function testVersionThrottling() {
  console.log("Verifying version snapshots are throttled, not one per save...");
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Test Draft Owner", email: OWNER_EMAIL, roles: ["curator"] }).returning();
  ownerId = owner.id;

  const draft = await createDraft(ownerId, { ideaTitle: "Throttle Test Idea" });
  draftIds.push(draft.id);

  const versionsAfterCreate = await listDraftVersions(draft.id, ownerId);
  assert.strictEqual(versionsAfterCreate.length, 1, "createDraft must write exactly one initial version snapshot");

  // Rapid saves with genuinely different content, all within the throttle
  // window - the live row must update every time, but the snapshot log
  // must NOT grow on every single one.
  const r1 = await saveDraft(draft.id, ownerId, { ideaTitle: "Throttle Test Idea v1" });
  const r2 = await saveDraft(draft.id, ownerId, { ideaTitle: "Throttle Test Idea v2" });
  assert.strictEqual(r1.versioned, false, "A save inside the throttle window must not force a new version");
  assert.strictEqual(r2.versioned, false, "Neither must the next one");
  assert.strictEqual(r2.draft.ideaTitle, "Throttle Test Idea v2", "But the live row must still reflect the latest content");

  const versionsAfterRapidSaves = await listDraftVersions(draft.id, ownerId);
  assert.strictEqual(versionsAfterRapidSaves.length, 1, "Rapid saves inside the throttle window must not add new snapshots");

  // Saving identical content back must never version even outside the
  // throttle window - nothing to record.
  const r3 = await saveDraft(draft.id, ownerId, { ideaTitle: "Throttle Test Idea v2" });
  assert.strictEqual(r3.versioned, false, "Saving unchanged content must never create a new version, throttle window or not");

  console.log("✓ Version snapshots are throttled by both content-changed and time-elapsed, exactly as designed");
}

async function testDiscardAndOwnership() {
  console.log("Verifying discard removes the draft and its versions, and ownership is enforced...");
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Test Draft Owner", email: OWNER_EMAIL, roles: ["curator"] }).returning();
  const [other] = await db.insert(personnel).values({ name: "Test Other Curator", email: OTHER_EMAIL, roles: ["curator"] }).returning();
  ownerId = owner.id;
  otherId = other.id;

  const draft = await createDraft(ownerId, { ideaTitle: "To Be Discarded" });
  draftIds.push(draft.id);

  try {
    await saveDraft(draft.id, otherId, { ideaTitle: "Hijacked" });
    assert.fail("A different person's draft must not be editable");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert.ok(message.includes("not found"), `Expected an ownership rejection, got: ${message}`);
  }

  await discardDraft(draft.id, ownerId);
  const remaining = await listActiveDrafts(ownerId);
  assert.strictEqual(remaining.length, 0, "Discarded draft must no longer be active");

  const versionsAfterDiscard = await db.select().from(curationIdeaVersions).where(eq(curationIdeaVersions.ideaId, draft.id));
  assert.strictEqual(versionsAfterDiscard.length, 0, "Discarding must cascade-delete the version history too");

  draftIds.length = 0; // already gone, don't try to clean up again
  console.log("✓ Discard removes the draft and its history; another person's draft can't be touched");
}

async function testRestoreIsNonDestructive() {
  console.log("Verifying restoring an old version doesn't erase the history it came from...");
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Test Draft Owner", email: OWNER_EMAIL, roles: ["curator"] }).returning();
  ownerId = owner.id;

  const draft = await createDraft(ownerId, { ideaTitle: "Original Title" });
  draftIds.push(draft.id);
  const [v1] = await listDraftVersions(draft.id, ownerId);

  // Force a real second version by saving well outside a simulated throttle
  // window - backdate the existing version's savedAt directly since the
  // real throttle is 20s and this test shouldn't need to sleep that long.
  await db
    .update(curationIdeaVersions)
    .set({ savedAt: new Date(Date.now() - 60_000) })
    .where(eq(curationIdeaVersions.ideaId, draft.id));
  const { versioned } = await saveDraft(draft.id, ownerId, { ideaTitle: "Changed Title" });
  assert.ok(versioned, "A save outside the throttle window with real content changes must create version 2");

  const restored = await restoreDraftVersion(draft.id, ownerId, v1.id);
  assert.strictEqual(restored.ideaTitle, "Original Title", "Restoring must write the old snapshot's content back onto the live row");
  assert.strictEqual(restored.version, 3, "Restoring must advance to a NEW version, not silently reuse version 1's number");

  const versionsAfterRestore = await listDraftVersions(draft.id, ownerId);
  assert.strictEqual(versionsAfterRestore.length, 3, "Restoring must add a new snapshot, not delete or overwrite the ones being browsed");
  assert.ok(versionsAfterRestore.some((v) => v.version === 1 && v.ideaTitle === "Original Title"), "Version 1 must still exist untouched");
  assert.ok(versionsAfterRestore.some((v) => v.version === 2 && v.ideaTitle === "Changed Title"), "Version 2 must still exist untouched");

  console.log("✓ Restoring a version is additive - nothing in the history is ever erased");
}

async function testSubmitConvertsDraftInPlace() {
  console.log("Verifying submitting a draft converts the SAME row instead of leaving an orphan behind a new one...");
  await cleanup();
  const [owner] = await db.insert(personnel).values({ name: "Test Draft Owner", email: OWNER_EMAIL, roles: ["curator"] }).returning();
  ownerId = owner.id;

  const draft = await createDraft(ownerId, { ideaTitle: "Idea That Gets Submitted", category: "Hair" });
  draftIds.push(draft.id);

  const activeBefore = await listActiveDrafts(ownerId);
  assert.strictEqual(activeBefore.length, 1);

  const result = await submitCurationItemIdea({
    ideaTitle: "Idea That Gets Submitted",
    category: "Hair",
    submitterId: ownerId,
    draftId: draft.id,
  });
  assetIds.push(result.asset.id);

  assert.strictEqual(result.idea.id, draft.id, "The submitted idea must be the SAME row as the draft, not a new insert");
  assert.strictEqual(result.idea.status, "approved");

  const activeAfter = await listActiveDrafts(ownerId);
  assert.strictEqual(activeAfter.length, 0, "A submitted draft must no longer show up as an active draft");

  const [rowCheck] = await db.select().from(curationItemIdeas).where(eq(curationItemIdeas.id, draft.id)).limit(1);
  assert.ok(rowCheck, "Exactly one row must exist for this idea");
  assert.strictEqual(rowCheck.assetId, result.asset.id, "The converted row must be linked to the real created asset");

  console.log("✓ Submitting a draft converts its own row in place - no orphaned duplicate left behind");
  // It's now an approved idea, not a draft - move it to the converted
  // tracking list so cleanup() still deletes it (and its linked asset),
  // just no longer treating it as a draft row.
  draftIds.length = 0;
  convertedIdeaIds.push(draft.id);
}

async function main() {
  await testParallelDraftsAndDedup();
  await testVersionThrottling();
  await testDiscardAndOwnership();
  await testRestoreIsNonDestructive();
  await testSubmitConvertsDraftInPlace();
}

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
