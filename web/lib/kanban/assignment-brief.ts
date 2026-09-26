import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { assignmentCcs } from "@/lib/db/schema/assignment_ccs";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";
import { getBriefFieldsForAsset } from "@/lib/curation/curation-service";
import { formatAssignmentEmailSubject, renderAssignmentEmailHtml } from "@/lib/email/templates/assignment-email";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { EMAIL_IMAGE_WIDTH_PX } from "@/lib/email/templates/email-layout";
import { parseDriveRefs, driveThumbnailUrl } from "@/lib/assets/drive-links";
import { artistOffersUrl } from "@/lib/offers/offer-notifications";

/**
 * Emails the artist the full brief for an asset they've agreed to make: the admin-configured
 * brief fields (Curation → Brief Fields), fee and category, CC'ing whoever was CC'd on the
 * assignment.
 *
 * Sent once the artist accepts the offer, or once the team approves their requested deadline. The
 * offer itself only carries the basics (name, picture, SKU, accessory type, fee, deadline), so
 * the full brief waits until the asset is actually theirs.
 *
 * Input: the asset, the artist, and the assignment whose CC list to copy. Output: nothing; the
 * email is queued and sent straight away when sending is set up.
 */
export async function sendAssignmentBrief(assetId: string, artistId: string, assignmentId: string | null) {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  const [artist] = await db.select().from(personnel).where(eq(personnel.id, artistId)).limit(1);
  if (!asset || !artist) return;

  const ccRows = assignmentId
    ? await db.select({ email: assignmentCcs.email }).from(assignmentCcs).where(eq(assignmentCcs.assignmentId, assignmentId))
    : [];
  const ccEmails = ccRows.map((row) => row.email);

  const briefFields = await getBriefFieldsForAsset(assetId);
  const firstImage = parseDriveRefs(asset.referenceImages).find((ref) => ref.fileId);
  const queuedEmail = await enqueueEmail({
    assetId,
    toEmail: artist.email,
    ccEmails,
    subject: formatAssignmentEmailSubject({ sku: asset.sku, itemName: asset.itemName }),
    bodyHtml: renderAssignmentEmailHtml({
      sku: asset.sku,
      itemName: asset.itemName,
      category: asset.category,
      artistName: artist.name,
      feeAmount: asset.feeAmount,
      currency: asset.currency,
      imageUrl: firstImage?.fileId ? driveThumbnailUrl(firstImage.fileId, EMAIL_IMAGE_WIDTH_PX) : null,
      tasksUrl: artistOffersUrl(),
      briefFields,
    }),
  });

  await db.insert(auditLog).values({
    action: "assignmentBriefQueued",
    entityType: "asset",
    entityId: assetId,
    actorId: null,
    payload: { artistId, ccEmails, queuedEmailId: queuedEmail.id },
  });

  await sendDueEmails().catch((error) => console.error("[brief] email send failed:", error));
}
