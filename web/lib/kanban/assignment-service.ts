import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { assignments } from "@/lib/db/schema/assignments";
import { assignmentCcs } from "@/lib/db/schema/assignment_ccs";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, desc } from "drizzle-orm";
import { createOfferAndNotifyArtist } from "@/lib/offers/offer-service";

export interface AssignArtistOptions {
  assetId: string;
  artistId: string;
  feeAmount?: string;
  deadline?: string; // ISO date string
  ccEmails?: string[];
  actorId?: string;
  reason?: string;
}

/**
 * Assigns an artist to an asset and sends them the offer for it.
 *
 * Input: the asset, the artist, and optionally a fee and deadline for this assignment (each falls
 * back to the asset's own), CC emails, who is assigning, and a reason for replacing an earlier
 * artist. Output: the new assignment's id, the previous artist, and the offer that was sent.
 *
 * The artist gets the offer by email and in their Discord channel, and accepts it, asks for a
 * later deadline, or declines it (see lib/offers/offer-service.ts). The full brief is emailed once
 * they accept (lib/kanban/assignment-brief.ts), not here. An offer needs a deadline, so this
 * refuses an asset with none when no deadline is given.
 */
export async function assignArtistToAsset(options: AssignArtistOptions) {
  const { assetId, artistId, feeAmount, deadline, ccEmails = [], actorId, reason } = options;

  // 1. Verify asset and artist exist
  const assetRecord = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (assetRecord.length === 0) throw new Error("Asset not found");

  const artistRecord = await db.select().from(personnel).where(eq(personnel.id, artistId)).limit(1);
  if (artistRecord.length === 0) throw new Error("Artist personnel not found");

  const offeredDeadline = deadline ? new Date(deadline) : assetRecord[0].deadline;
  if (!offeredDeadline) throw new Error("Set a deadline before assigning: the artist is offered the asset with it.");
  const offeredFee = feeAmount || assetRecord[0].feeAmount;

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
      assignedBy: actorId || null,
      deadline: offeredDeadline,
      feeAmount: offeredFee,
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

  // 5. The asset's own fee and deadline follow the assignment, since the board, the calendar and
  // the uploader queue all read them from the asset.
  await db
    .update(assets)
    .set({
      currentArtistId: artistId,
      ...(feeAmount ? { feeAmount } : {}),
      deadline: offeredDeadline,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, assetId));

  // 6. Log audit event
  await db.insert(auditLog).values({
    action: "assignArtist",
    entityType: "asset",
    entityId: assetId,
    actorId: actorId || null,
    payload: { previousArtistId, newArtistId: artistId, ccEmails },
  });

  // 7. Offer it to the artist, by email and Discord.
  const offer = await createOfferAndNotifyArtist({
    assetId,
    assignmentId: newAssignment.id,
    artistId,
    deadline: offeredDeadline,
    feeAmount: offeredFee,
    currency: assetRecord[0].currency,
    createdBy: actorId,
  });

  return {
    assignmentId: newAssignment.id,
    assetId,
    artistId,
    previousArtistId,
    offerId: offer.id,
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
