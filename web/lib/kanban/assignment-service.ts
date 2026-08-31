import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { assignments } from "@/lib/db/schema/assignments";
import { assignmentCcs } from "@/lib/db/schema/assignment_ccs";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, desc } from "drizzle-orm";
import { getBriefFieldsForAsset } from "@/lib/curation/curation-service";
import { formatAssignmentEmailSubject, renderAssignmentEmailHtml } from "@/lib/email/templates/assignment-email";
import { enqueueEmail } from "@/lib/email/queue-worker";

export interface AssignArtistOptions {
  assetId: string;
  artistId: string;
  feeAmount?: string;
  deadline?: string; // ISO date string
  ccEmails?: string[];
  actorId?: string;
  reason?: string;
}

export async function assignArtistToAsset(options: AssignArtistOptions) {
  const { assetId, artistId, feeAmount, deadline, ccEmails = [], actorId, reason } = options;

  // 1. Verify asset and artist exist
  const assetRecord = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (assetRecord.length === 0) throw new Error("Asset not found");

  const artistRecord = await db.select().from(personnel).where(eq(personnel.id, artistId)).limit(1);
  if (artistRecord.length === 0) throw new Error("Artist personnel not found");

  const previousArtistId = assetRecord[0].currentArtistId;

  // 2. Deactivate previous active assignments
  await db
    .update(assignments)
    .set({
      isActive: false,
      unassignedAt: new Date(),
      unassignedReason: reason || "Re-assigned to new artist",
    })
    .where(eq(assignments.assetId, assetId));

  // 3. Insert new active assignment
  const [newAssignment] = await db
    .insert(assignments)
    .values({
      assetId,
      artistId,
      feeAmount: feeAmount || assetRecord[0].feeAmount,
      isActive: true,
      assignedAt: new Date(),
    })
    .returning();

  // 4. Add CC list entries. Each address is independent of the others, so they resolve and insert concurrently rather than costing two sequential round trips per address.
  await Promise.all(
    ccEmails
      .map((ccEmail) => ccEmail.trim().toLowerCase())
      .filter(Boolean)
      .map(async (trimmed) => {
        const ccPerson = await db.select().from(personnel).where(eq(personnel.email, trimmed)).limit(1);
        await db.insert(assignmentCcs).values({
          assignmentId: newAssignment.id,
          email: trimmed,
          personnelId: ccPerson.length > 0 ? ccPerson[0].id : null,
        });
      })
  );

  // 5. Update asset record — feeAmount/deadline were previously only used
  // transiently for the assignment record and the email render, never
  // written back to the asset itself. Real bug: the Kanban card reads
  // assets.feeAmount directly, so a fee set here wouldn't have shown up on
  // the card at all until someone separately edited the asset.
  await db
    .update(assets)
    .set({
      currentArtistId: artistId,
      ...(feeAmount ? { feeAmount } : {}),
      ...(deadline ? { deadline: new Date(deadline) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId));

  // 6. Queue the assignment email - admin-configured brief fields (P3-T9),
  // real template (P2-T18), real queue (P2-T17). Without this step the
  // three pieces exist but are never actually called together (P2-T16b).
  const briefFields = await getBriefFieldsForAsset(assetId);
  const emailHtml = renderAssignmentEmailHtml({
    sku: assetRecord[0].sku,
    itemName: assetRecord[0].itemName,
    category: assetRecord[0].category,
    artistName: artistRecord[0].name,
    feeAmount: feeAmount || assetRecord[0].feeAmount,
    briefFields,
  });
  const queuedEmail = await enqueueEmail({
    assetId,
    toEmail: artistRecord[0].email,
    ccEmails,
    subject: formatAssignmentEmailSubject({ sku: assetRecord[0].sku, itemName: assetRecord[0].itemName }),
    bodyHtml: emailHtml,
  });

  // 7. Log audit event
  await db.insert(auditLog).values({
    action: "assignArtist",
    entityType: "asset",
    entityId: assetId,
    actorId: actorId || null,
    payload: { previousArtistId, newArtistId: artistId, ccEmails, queuedEmailId: queuedEmail.id },
  });

  return {
    assignmentId: newAssignment.id,
    assetId,
    artistId,
    previousArtistId,
    queuedEmailId: queuedEmail.id,
  };
}

export async function getAssetAssignmentHistory(assetId: string) {
  const history = await db
    .select({
      id: assignments.id,
      artistId: assignments.artistId,
      artistName: personnel.name,
      artistEmail: personnel.email,
      feeAmount: assignments.feeAmount,
      isActive: assignments.isActive,
      assignedAt: assignments.assignedAt,
      unassignedAt: assignments.unassignedAt,
      unassignedReason: assignments.unassignedReason,
    })
    .from(assignments)
    .leftJoin(personnel, eq(assignments.artistId, personnel.id))
    .where(eq(assignments.assetId, assetId))
    .orderBy(desc(assignments.assignedAt));

  return history;
}
