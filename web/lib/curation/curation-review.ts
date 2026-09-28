import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { curationItemIdeas } from "@/lib/db/schema/curation_item_ideas";
import { curationFieldConfig } from "@/lib/db/schema/curation_field_config";
import { personnel } from "@/lib/db/schema/personnel";
import { asc, eq } from "drizzle-orm";
import { CURATED_STATUS } from "@/lib/kanban/move-rules";
import { parseDriveRefs, driveThumbnailUrl } from "@/lib/assets/drive-links";
import { EMAIL_IMAGE_WIDTH_PX, renderEmailLayout, EMAIL_TONE } from "@/lib/email/templates/email-layout";
import { enqueueEmail, sendDueEmails } from "@/lib/email/queue-worker";
import { appUrl } from "@/lib/app-url";

/** A curation review action refused for a reason the caller can show as it is. */
export class CurationReviewError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "CurationReviewError";
  }
}

export interface CurationReviewField {
  label: string;
  value: string;
}

/** The idea behind a card in Curated, as the asset drawer shows it to the reviewer. */
export interface CurationReview {
  ideaTitle: string;
  curatorName: string | null;
  submittedAt: Date;
  /** 'in_review' while waiting for the team, 'draft' while sent back to the curator. */
  status: string;
  reviewNote: string | null;
  /** Every curation field the curator filled in, labelled as the form labels it. */
  fields: CurationReviewField[];
  sourceLinks: string[];
}

async function findCuratedIdea(sku: string) {
  const [row] = await db
    .select({ asset: assets, idea: curationItemIdeas })
    .from(assets)
    .innerJoin(curationItemIdeas, eq(curationItemIdeas.assetId, assets.id))
    .where(eq(assets.sku, sku))
    .limit(1);
  return row ?? null;
}

/**
 * What the curator wrote for the idea behind this asset, for the team to review.
 *
 * Input: the asset's SKU. Output: the idea, or null when the asset didn't come from the curation form.
 */
export async function getCurationReview(sku: string): Promise<CurationReview | null> {
  const row = await findCuratedIdea(sku);
  if (!row) return null;
  const { idea } = row;

  const [configs, [curator]] = await Promise.all([
    db
      .select({ fieldKey: curationFieldConfig.fieldKey, displayName: curationFieldConfig.displayName })
      .from(curationFieldConfig)
      .orderBy(asc(curationFieldConfig.sortOrder)),
    idea.submittedBy
      ? db.select({ name: personnel.name }).from(personnel).where(eq(personnel.id, idea.submittedBy)).limit(1)
      : Promise.resolve([]),
  ]);

  const values = (idea.fieldValues as Record<string, unknown>) || {};
  const fields: CurationReviewField[] = [];
  for (const config of configs) {
    const value = values[config.fieldKey];
    if (typeof value === "string" && value.trim() !== "") fields.push({ label: config.displayName, value: value.trim() });
  }

  return {
    ideaTitle: idea.ideaTitle,
    curatorName: curator?.name ?? null,
    submittedAt: idea.updatedAt,
    status: idea.status,
    reviewNote: idea.reviewNote,
    fields,
    sourceLinks: (idea.sourceLinks as string[] | null) ?? [],
  };
}

/**
 * Sends a curated idea back to its curator with a note. The idea returns to their drafts with the
 * note, the card stays in Curated, and the curator is emailed.
 *
 * Input: the asset's SKU, the note, and the personnel id of who sent it back. Output: the curator's
 * email, or null when the idea has no curator to email.
 */
export async function sendCurationBack(
  sku: string,
  note: string,
  reviewerId: string | undefined
): Promise<{ curatorEmail: string | null }> {
  const row = await findCuratedIdea(sku);
  if (!row) throw new CurationReviewError("This asset didn't come from the curation form, so there is no curator to send it back to.", 404);
  const { asset, idea } = row;
  if (asset.currentStatus !== CURATED_STATUS) {
    throw new CurationReviewError("Only an idea waiting in Curated can be sent back.", 409);
  }

  await db
    .update(curationItemIdeas)
    .set({ status: "draft", reviewNote: note, updatedAt: new Date() })
    .where(eq(curationItemIdeas.id, idea.id));

  await db.insert(auditLog).values({
    action: "sendCurationBack",
    entityType: "asset",
    entityId: asset.id,
    actorId: reviewerId ?? null,
    payload: { sku, ideaId: idea.id, note },
  });

  if (!idea.submittedBy) return { curatorEmail: null };
  const [[curator], [reviewer]] = await Promise.all([
    db.select({ name: personnel.name, email: personnel.email }).from(personnel).where(eq(personnel.id, idea.submittedBy)).limit(1),
    reviewerId
      ? db.select({ name: personnel.name }).from(personnel).where(eq(personnel.id, reviewerId)).limit(1)
      : Promise.resolve([]),
  ]);
  if (!curator) return { curatorEmail: null };

  const firstImage = parseDriveRefs(asset.referenceImages).find((ref) => ref.fileId);
  const reviewerName = reviewer?.name || "The team";
  const bodyHtml = renderEmailLayout({
    preheader: `${reviewerName} sent it back: ${note}`,
    eyebrow: "Changes requested",
    tone: EMAIL_TONE.neutral,
    title: asset.itemName,
    meta: [asset.sku, asset.category || ""],
    imageUrl: firstImage?.fileId ? driveThumbnailUrl(firstImage.fileId, EMAIL_IMAGE_WIDTH_PX) : null,
    stats: [],
    intro: `Hi ${curator.name}, ${reviewerName} sent this idea back with a note. It's in My Drafts on the Curation page. Make the changes and send it again; it keeps the same SKU.`,
    quote: { label: `${reviewerName}'s note`, text: note },
    button: { label: "Open My Drafts", url: appUrl("/curator") },
  });

  // Queued, then sent straight away. A failed send stays queued for the daily retry, so it must
  // not undo the send-back itself.
  try {
    await enqueueEmail({ assetId: asset.id, toEmail: curator.email, subject: `Changes requested: ${asset.itemName} (${asset.sku})`, bodyHtml });
    await sendDueEmails();
  } catch (error) {
    console.error("[curation] send-back email failed:", error);
  }

  return { curatorEmail: curator.email };
}
