import assert from "node:assert";
import { assignArtistToAsset } from "../assignment-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { assignments } from "@/lib/db/schema/assignments";
import { assignmentCcs } from "@/lib/db/schema/assignment_ccs";
import { emailQueue } from "@/lib/db/schema/email_queue";
import { auditLog } from "@/lib/db/schema/audit_log";
import { and, eq, inArray } from "drizzle-orm";

const TEST_SKU = "TEST-ASSIGNMENT-SERVICE-SKU";
const ARTIST_EMAIL = "test-assignment-service-artist@example.com";
const ARTIST2_EMAIL = "test-assignment-service-artist-2@example.com";
const RANDOM_CC_EMAIL = "test-assignment-service-random-cc@example.com";

let assetId = "";

async function cleanup() {
  if (assetId) {
    await db.delete(auditLog).where(eq(auditLog.entityId, assetId));
    // Deleting the asset cascades to assignments -> assignment_ccs, and to email_queue.
    await db.delete(assets).where(eq(assets.id, assetId));
  }
  await db.delete(personnel).where(inArray(personnel.email, [ARTIST_EMAIL, ARTIST2_EMAIL]));
}

async function testAssetNotFoundThrows() {
  console.log("Verifying assignArtistToAsset() rejects a non-existent asset...");
  try {
    await assignArtistToAsset({
      assetId: "00000000-0000-0000-0000-000000000000",
      artistId: "00000000-0000-0000-0000-000000000000",
    });
    assert.fail("Should throw for a non-existent asset");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    assert.strictEqual(message, "Asset not found");
    console.log("Caught expected error:", message);
  }
}

async function testAssignAndReassignFlow() {
  console.log("Verifying assignArtistToAsset() real assign/reassign side effects against a live DB...");
  await cleanup();

  const [artist] = await db.insert(personnel).values({ name: "Test Assignment Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  const [artist2] = await db.insert(personnel).values({ name: "Test Assignment Artist Two", email: ARTIST2_EMAIL, roles: ["artist"] }).returning();
  const [asset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU, itemName: "Test Assignment Asset", currentStatus: "unassigned", feeAmount: "150.00" })
    .returning();
  assetId = asset.id;

  try {
    // Artist not found, real asset this time.
    try {
      await assignArtistToAsset({ assetId, artistId: "00000000-0000-0000-0000-000000000000" });
      assert.fail("Should throw for a non-existent artist");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      assert.strictEqual(message, "Artist personnel not found");
      console.log("Caught expected error for non-existent artist:", message);
    }

    // First assignment: nothing to deactivate yet. CC list mixes an email that
    // matches a real personnel row (artist2) and one that matches nobody.
    const result = await assignArtistToAsset({
      assetId,
      artistId: artist.id,
      ccEmails: [ARTIST2_EMAIL, RANDOM_CC_EMAIL],
    });
    assert.strictEqual(result.assetId, assetId);
    assert.strictEqual(result.artistId, artist.id);
    assert.strictEqual(result.previousArtistId, null, "A fresh asset has no previous artist");

    const activeAfterFirst = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.assetId, assetId), eq(assignments.isActive, true)));
    assert.strictEqual(activeAfterFirst.length, 1, "Exactly one active assignment must exist after the first assign");
    assert.strictEqual(activeAfterFirst[0].id, result.assignmentId);
    assert.strictEqual(activeAfterFirst[0].artistId, artist.id);
    assert.strictEqual(activeAfterFirst[0].feeAmount, "150.00", "Fee falls back to the asset's own fee when not overridden");

    const ccs = await db.select().from(assignmentCcs).where(eq(assignmentCcs.assignmentId, result.assignmentId));
    assert.strictEqual(ccs.length, 2, "Both CC emails must land as assignment_ccs rows");
    const ccByEmail = new Map(ccs.map((c) => [c.email, c]));
    assert.strictEqual(
      ccByEmail.get(ARTIST2_EMAIL)?.personnelId,
      artist2.id,
      "A CC email matching a real personnel row must be linked to that row"
    );
    assert.strictEqual(
      ccByEmail.get(RANDOM_CC_EMAIL)?.personnelId,
      null,
      "A CC email with no matching personnel row must still be inserted, linked to null"
    );

    const queuedAfterFirst = await db.select().from(emailQueue).where(eq(emailQueue.assetId, assetId));
    assert.strictEqual(queuedAfterFirst.length, 1, "Exactly one email must be queued");
    assert.strictEqual(queuedAfterFirst[0].id, result.queuedEmailId);
    assert.strictEqual(queuedAfterFirst[0].toEmail, ARTIST_EMAIL, "Queued email must go to the newly assigned artist");
    assert.strictEqual(queuedAfterFirst[0].subject, `Meta Fashion Assignment | ${TEST_SKU} | Test Assignment Asset`);
    assert.strictEqual(queuedAfterFirst[0].status, "pending");

    const [assetAfterFirst] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    assert.strictEqual(assetAfterFirst.currentArtistId, artist.id, "Asset's currentArtistId must be updated to the new artist");

    const [audit1] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, assetId), eq(auditLog.action, "assignArtist")));
    assert.ok(audit1, "assignArtist must be audit-logged");
    assert.strictEqual(audit1.entityType, "asset");
    const payload1 = audit1.payload as Record<string, unknown>;
    assert.strictEqual(payload1.previousArtistId, null);
    assert.strictEqual(payload1.newArtistId, artist.id);
    assert.strictEqual(payload1.queuedEmailId, result.queuedEmailId);

    console.log("Confirmed first assignment: active row, CC resolution (linked + unlinked), queued email, audit log");

    // Reassign to a different artist with no explicit reason, to exercise the
    // real default unassign-reason path, not a re-typed assumption of it.
    const result2 = await assignArtistToAsset({ assetId, artistId: artist2.id });
    assert.strictEqual(result2.previousArtistId, artist.id, "Second call must report the first artist as previous");

    const [deactivated] = await db.select().from(assignments).where(eq(assignments.id, result.assignmentId)).limit(1);
    assert.strictEqual(deactivated.isActive, false, "Previous assignment must be deactivated on reassignment");
    assert.ok(deactivated.unassignedAt, "Deactivated assignment must record when it was unassigned");
    assert.strictEqual(deactivated.unassignedReason, "Re-assigned to new artist", "Default unassign reason must be used when none is given");

    const activeAfterReassign = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.assetId, assetId), eq(assignments.isActive, true)));
    assert.strictEqual(activeAfterReassign.length, 1, "Exactly one active assignment must exist after reassignment");
    assert.strictEqual(activeAfterReassign[0].id, result2.assignmentId);
    assert.strictEqual(activeAfterReassign[0].artistId, artist2.id);

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, assetId), eq(auditLog.action, "assignArtist")));
    assert.strictEqual(auditRows.length, 2, "Both assignArtist calls must each write their own audit log entry");
    const audit2 = auditRows.find((a) => a.id !== audit1.id);
    assert.ok(audit2, "A second, distinct audit log row must exist for the reassignment");
    const payload2 = audit2!.payload as Record<string, unknown>;
    assert.strictEqual(payload2.previousArtistId, artist.id, "Second audit entry must record the previously assigned artist");
    assert.strictEqual(payload2.newArtistId, artist2.id);

    console.log("Confirmed reassignment deactivates the previous assignment and logs its own audit entry");
  } finally {
    await cleanup();
  }
}

// Real bug fix, verified: feeAmount/deadline passed to assignArtistToAsset
// used to be used only transiently (the assignment record, the email render)
// and never written back to assets.feeAmount/assets.deadline — the columns
// the Kanban card actually reads. A fee set at assignment time wouldn't have
// shown up on the card until someone separately edited the asset.
async function testFeeAndDeadlinePersistToAsset() {
  console.log("Verifying feeAmount/deadline set at assignment time actually persist to the asset, not just the assignment record...");
  await cleanup();

  const [artist] = await db.insert(personnel).values({ name: "Test Assignment Artist", email: ARTIST_EMAIL, roles: ["artist"] }).returning();
  const [asset] = await db
    .insert(assets)
    .values({ sku: TEST_SKU, itemName: "Test Fee/Deadline Asset", currentStatus: "unassigned" })
    .returning();
  assetId = asset.id;

  try {
    await assignArtistToAsset({
      assetId,
      artistId: artist.id,
      feeAmount: "425.00",
      deadline: "2026-09-15",
    });

    const [assetAfter] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    assert.strictEqual(assetAfter.feeAmount, "425.00", "assets.feeAmount must be updated by assignment, not just the assignment row");
    assert.ok(assetAfter.deadline, "assets.deadline must be set");
    assert.strictEqual(
      new Date(assetAfter.deadline!).toISOString().slice(0, 10),
      "2026-09-15",
      "assets.deadline must match the date passed to assignArtistToAsset"
    );

    console.log("Confirmed feeAmount and deadline both persist to the asset itself");
  } finally {
    await cleanup();
  }
}

async function main() {
  await testAssetNotFoundThrows();
  await testAssignAndReassignFlow();
  await testFeeAndDeadlinePersistToAsset();
  console.log("✓ All assignment-service.ts assertions passed cleanly!");
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Test failed:", err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
