import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { assetDeliverables } from "@/lib/db/schema/asset_deliverables";
import { assetFinalSubmissions } from "@/lib/db/schema/asset_final_submissions";
import { personnel } from "@/lib/db/schema/personnel";
import { checkFinalZip, type FinalFileKind } from "./final-zip";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { asc, desc, eq, max } from "drizzle-orm";
import { updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import { driveFolderUrl } from "@/lib/assets/drive-upload";

// The only status an asset takes final files in: the design is approved and nothing is handed in yet.
export const FINAL_FILES_ACCEPTED_FROM_STATUS = "approved";

/** One file of a final-files submission, already verified to be in the submission's Drive folder. */
export interface FinalFileInput {
  /** What the file is: the one .zip an artist hands in. */
  kind: FinalFileKind;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  driveFileId: string;
  driveUrl: string;
  driveFolderId: string;
}

/** The version number the asset's next final-files submission gets: 1, then one more than the last. */
export async function nextFinalFilesVersion(assetId: string): Promise<number> {
  const [row] = await db
    .select({ latest: max(assetDeliverables.version) })
    .from(assetDeliverables)
    .where(eq(assetDeliverables.assetId, assetId));
  return (row?.latest ?? 0) + 1;
}

/**
 * Records a final-files submission and puts the asset in the uploader's queue.
 *
 * Input: the SKU, the submission's version, its files, who submitted, and the artist's comments.
 * Output: the asset's new status.
 *
 * Per the brief's §8 the asset has to be Approved and the submission has to hold at least one
 * file; either failure is refused and audit-logged. A valid submission writes one
 * asset_deliverables row per file, moves Approved → Final Files Received, then straight on to
 * Ready for Upload, so the uploader sees it without anyone clicking "Notify uploader". Both moves
 * go through the seeded automatic transitions and are written to status history.
 */
export async function submitFinalFiles(
  sku: string,
  version: number,
  files: FinalFileInput[],
  submitterId?: string,
  comments?: string
) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  if (fromStatus !== FINAL_FILES_ACCEPTED_FROM_STATUS) {
    await db.insert(auditLog).values({
      action: "submitFinalDeliverables_rejected",
      entityType: "asset",
      entityId: asset.id,
      actorId: submitterId || null,
      payload: { sku, reason: `Asset not in Approved status (currently: ${fromStatus})`, version },
    });
    throw new Error(
      `Submission rejected: '${sku}' must be in Approved status to accept final files (currently: ${fromStatus}).`
    );
  }

  if (files.length === 0) {
    await db.insert(auditLog).values({
      action: "submitFinalDeliverables_rejected",
      entityType: "asset",
      entityId: asset.id,
      actorId: submitterId || null,
      payload: { sku, reason: "No files provided", version },
    });
    throw new Error("Submission rejected: at least one final file is required.");
  }

  // Everything goes in one .zip, the same rule the Submit final files page checks before uploading.
  if (files.length > 1) throw new Error("Submission rejected: hand in one .zip with everything in it.");
  const problem = checkFinalZip(files[0].fileName, files[0].sizeBytes ?? 0);
  if (problem) throw new Error(`Submission rejected: ${problem}`);

  const [submission] = await db
    .insert(assetFinalSubmissions)
    .values({ assetId: asset.id, version, comments: comments || null, submittedBy: submitterId || null })
    .returning({ id: assetFinalSubmissions.id });

  await db.insert(assetDeliverables).values(
    files.map((file) => ({ ...file, assetId: asset.id, version, submissionId: submission.id, uploadedBy: submitterId || null }))
  );

  await updateAssetStatusInKanban(
    sku,
    "final_files_received",
    { system: true },
    comments ? `Final files v${version} submitted: ${comments}` : `Final files v${version} submitted (${files.length} files)`
  );

  await db.insert(auditLog).values({
    action: "submitFinalDeliverables",
    entityType: "asset",
    entityId: asset.id,
    actorId: submitterId || null,
    payload: { sku, version, submissionId: submission.id, files: files.map((f) => ({ name: f.fileName, kind: f.kind, driveFileId: f.driveFileId })) },
  });

  const queued = await notifyUploader(sku, submitterId, `Final files v${version} are in Drive, ready to upload`);
  return { success: true, sku, version, currentStatus: queued.currentStatus };
}

export interface FinalFilesSubmission {
  version: number;
  folderUrl: string;
  submittedAt: Date;
  /** The artist's comments on this hand-in, or null. */
  comments: string | null;
  /** Who handed it in, or null when unknown. */
  submittedBy: string | null;
  files: {
    id: string;
    kind: FinalFileKind | null;
    fileName: string;
    mimeType: string | null;
    sizeBytes: number | null;
    driveUrl: string;
  }[];
}

/**
 * Every final-files submission for an asset, newest version first, each with its files, its
 * folder, the artist's comments and who handed it in.
 */
export async function getFinalFilesForAsset(assetId: string): Promise<FinalFilesSubmission[]> {
  const [rows, submissions] = await Promise.all([
    db
      .select()
      .from(assetDeliverables)
      .where(eq(assetDeliverables.assetId, assetId))
      .orderBy(desc(assetDeliverables.version), asc(assetDeliverables.fileName)),
    db
      .select({ version: assetFinalSubmissions.version, comments: assetFinalSubmissions.comments, submittedBy: personnel.name })
      .from(assetFinalSubmissions)
      .leftJoin(personnel, eq(assetFinalSubmissions.submittedBy, personnel.id))
      .where(eq(assetFinalSubmissions.assetId, assetId)),
  ]);
  const submissionByVersion = new Map(submissions.map((s) => [s.version, s]));

  const byVersion = new Map<number, FinalFilesSubmission>();
  for (const row of rows) {
    const submission = byVersion.get(row.version) ?? {
      version: row.version,
      folderUrl: driveFolderUrl(row.driveFolderId),
      submittedAt: row.createdAt,
      comments: submissionByVersion.get(row.version)?.comments ?? null,
      submittedBy: submissionByVersion.get(row.version)?.submittedBy ?? null,
      files: [],
    };
    submission.files.push({
      id: row.id,
      kind: row.kind,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      driveUrl: row.driveUrl,
    });
    byVersion.set(row.version, submission);
  }
  return Array.from(byVersion.values());
}

// "Notify uploader" is a real card action in the brief's §5 and a real
// automatic-transition trigger in §5 ("Uploader notified → Ready for
// Upload") — didn't exist anywhere in the codebase before this. The brief
// doesn't describe a per-person uploader assignment the way artists get
// assigned (§9 just says the uploader "receives SKU, item name, final
// folder, upload instructions" once notified) — so this puts the asset into
// a shared Ready for Upload queue any Uploader/Publisher-role person can
// see and act on, rather than inventing a second assignment system the
// brief never asked for.
export async function notifyUploader(sku: string, actorId?: string, notes?: string) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  if (fromStatus !== "final_files_received") {
    throw new Error(
      `Cannot notify the uploader: '${sku}' must have final files received first (currently: ${fromStatus}).`
    );
  }

  await db
    .update(assets)
    .set({ currentStatus: "ready_for_upload", updatedAt: new Date() })
    .where(eq(assets.id, asset.id));

  await db.insert(statusHistory).values({
    assetId: asset.id,
    fromStatus,
    toStatus: "ready_for_upload",
    actorId: actorId || null,
    note: notes || "Uploader notified — final files, folder, and upload instructions ready",
  });

  await db.insert(auditLog).values({
    action: "notifyUploader",
    entityType: "asset",
    entityId: asset.id,
    actorId: actorId || null,
    payload: { sku },
  });

  return { success: true, sku, currentStatus: "ready_for_upload" };
}

export async function markAssetForPayment(sku: string, actorId?: string, notes?: string) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const fromStatus = asset.currentStatus;

  // 🔒 STRICT PAYMENT GATE ENFORCEMENT: Only assets in 'uploaded_to_roblox' can be marked for payment
  if (fromStatus !== "uploaded_to_roblox") {
    throw new Error(
      `Payment gate restriction: Assets can only be marked for payment after being uploaded to Roblox (current status: '${fromStatus}')`
    );
  }

  await db
    .update(assets)
    .set({
      currentStatus: "marked_for_payment",
      updatedAt: new Date(),
    })
    .where(eq(assets.id, asset.id));

  await db.insert(statusHistory).values({
    assetId: asset.id,
    fromStatus,
    toStatus: "marked_for_payment",
    actorId: actorId || null,
    note: notes || "Marked for payment after Roblox upload",
  });

  await db.insert(auditLog).values({
    action: "markForPayment",
    entityType: "asset",
    entityId: asset.id,
    actorId: actorId || null,
    payload: { sku, fromStatus },
  });

  return { success: true, sku, currentStatus: "marked_for_payment" };
}
