import { db } from "@/lib/db/client";
import { curationFieldConfig } from "@/lib/db/schema/curation_field_config";
import { curationItemIdeas } from "@/lib/db/schema/curation_item_ideas";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, asc } from "drizzle-orm";

export interface CreateCurationFieldOptions {
  fieldKey: string;
  displayName: string;
  includeInArtistEmail?: boolean;
  sortOrder?: number;
}

export async function addCurationFieldConfig(options: CreateCurationFieldOptions) {
  const { fieldKey, displayName, includeInArtistEmail = true, sortOrder = 0 } = options;

  const [field] = await db
    .insert(curationFieldConfig)
    .values({
      fieldKey,
      displayName,
      includeInArtistEmail,
      sortOrder,
    })
    .returning();

  return field;
}

export async function getCurationFieldConfigs() {
  return await db.select().from(curationFieldConfig).orderBy(asc(curationFieldConfig.sortOrder));
}

export interface UpdateCurationFieldConfigInput {
  includeInArtistEmail?: boolean;
  displayName?: string;
  sortOrder?: number;
}

// Toggling includeInArtistEmail here changes what the *next* assignment email
// contains via getBriefFieldsForAsset() below - no code change needed (P3-T9).
export async function updateCurationFieldConfig(fieldKey: string, input: UpdateCurationFieldConfigInput) {
  const [row] = await db
    .update(curationFieldConfig)
    .set(input)
    .where(eq(curationFieldConfig.fieldKey, fieldKey))
    .returning();
  if (!row) throw new Error(`No curation field config found for key '${fieldKey}'`);
  return row;
}

// Maps a curation_field_config.fieldKey to how its value is read off an assets row.
// Only fields with a real backing column are eligible to be selected as brief fields.
const ASSET_FIELD_ACCESSORS: Record<string, (asset: typeof assets.$inferSelect) => string | null> = {
  deadline: (asset) => (asset.deadline ? new Date(asset.deadline).toLocaleDateString() : null),
  recolorInstructions: (asset) => {
    const recolors = (asset.recolorReferenceImages as Array<{ externalId: string }> | null) || [];
    return recolors.length > 0 ? recolors.map((r) => r.externalId).join(", ") : null;
  },
};

export interface BriefField {
  key: string;
  displayName: string;
  value: string;
}

// Returns the ordered list of optional brief fields to include in an assignment
// email for this asset, per the admin-toggleable curation_field_config table.
export async function getBriefFieldsForAsset(assetId: string): Promise<BriefField[]> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) throw new Error(`Asset '${assetId}' not found`);

  const configs = await db
    .select()
    .from(curationFieldConfig)
    .where(eq(curationFieldConfig.includeInArtistEmail, true))
    .orderBy(asc(curationFieldConfig.sortOrder));

  const fields: BriefField[] = [];
  for (const config of configs) {
    const accessor = ASSET_FIELD_ACCESSORS[config.fieldKey];
    if (!accessor) continue; // no known backing column for this field yet
    const value = accessor(asset);
    if (value) fields.push({ key: config.fieldKey, displayName: config.displayName, value });
  }
  return fields;
}

export async function seedDefaultCurationFieldConfig() {
  const defaults: CreateCurationFieldOptions[] = [
    { fieldKey: "deadline", displayName: "Deadline", includeInArtistEmail: true, sortOrder: 1 },
    { fieldKey: "recolorInstructions", displayName: "Recolor Instructions", includeInArtistEmail: true, sortOrder: 2 },
  ];
  for (const field of defaults) {
    const existing = await db
      .select()
      .from(curationFieldConfig)
      .where(eq(curationFieldConfig.fieldKey, field.fieldKey))
      .limit(1);
    if (existing.length === 0) {
      await addCurationFieldConfig(field);
    }
  }
}

// Generates a unique-enough SKU for an asset created outside the historical import flow.
// Shared by curation item ideas and admin-created assets so there is one SKU scheme, not two.
export function generateAssetSku(prefix: string): string {
  return `SKU-${prefix}-${Date.now().toString().slice(-6)}`;
}

export interface SubmitItemIdeaOptions {
  ideaTitle: string;
  category?: string;
  trendReasoning?: string;
  sourceLinks?: string[];
  moodboardUrls?: string[];
  submitterId?: string;
}

export async function submitCurationItemIdea(options: SubmitItemIdeaOptions) {
  const { ideaTitle, category, trendReasoning, sourceLinks = [], moodboardUrls = [], submitterId } = options;

  // 1. Record item idea
  const [idea] = await db
    .insert(curationItemIdeas)
    .values({
      ideaTitle,
      category: category || null,
      trendReasoning: trendReasoning || null,
      sourceLinks,
      moodboardUrls,
      submittedBy: submitterId || null,
      status: "approved",
    })
    .returning();

  // 2. Auto-generate SKU and create asset at 'unassigned'
  const sku = generateAssetSku("IDEA");
  const [asset] = await db
    .insert(assets)
    .values({
      sku,
      itemName: ideaTitle,
      category: category || null,
      currentStatus: "unassigned",
      referenceImages: moodboardUrls.map((url) => ({ provider: "filestore", externalId: url })),
    })
    .returning();

  // 3. Log audit event
  await db.insert(auditLog).values({
    action: "submitCurationItemIdea",
    entityType: "asset",
    entityId: asset.id,
    actorId: submitterId || null,
    payload: { ideaId: idea.id, sku, ideaTitle },
  });

  return { idea, asset, sku, currentStatus: "unassigned" };
}

export async function updateRecolorReferenceImages(
  sku: string,
  recolorUrls: string[],
  actorId?: string,
  note?: string
) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const existingRecolors = (asset.recolorReferenceImages as Array<{ provider: string; externalId: string }>) || [];
  const newRecolors = recolorUrls.map((url) => ({ provider: "filestore", externalId: url }));
  const updatedRecolors = [...existingRecolors, ...newRecolors];

  // Update recolorReferenceImages without changing currentStatus
  await db
    .update(assets)
    .set({
      recolorReferenceImages: updatedRecolors,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, asset.id));

  // Record audit log entry
  await db.insert(auditLog).values({
    action: "updateRecolorReferenceImages",
    entityType: "asset",
    entityId: asset.id,
    actorId: actorId || null,
    payload: { sku, recolorUrls, note: note || "Operator updated recolor reference images" },
  });

  return {
    sku,
    currentStatus: asset.currentStatus, // Status remains unchanged!
    recolorReferenceImages: updatedRecolors,
  };
}

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "RUB"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export interface UpdateAssetPaymentDetailsInput {
  currency?: SupportedCurrency;
  paymentReceiptUrl?: string;
}

// Sets an asset's currency and/or payment receipt URL without changing currentStatus.
// Attaching a receipt here is what satisfies the payment gate in kanban-service.ts,
// which blocks the payment_done transition until this has been called.
export async function updateAssetPaymentDetails(
  sku: string,
  updates: UpdateAssetPaymentDetailsInput,
  actorId?: string,
  note?: string
) {
  if (updates.currency && !SUPPORTED_CURRENCIES.includes(updates.currency)) {
    throw new Error(`Unsupported currency '${updates.currency}' - must be one of ${SUPPORTED_CURRENCIES.join(", ")}`);
  }

  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];

  await db
    .update(assets)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, asset.id));

  await db.insert(auditLog).values({
    action: "updateAssetPaymentDetails",
    entityType: "asset",
    entityId: asset.id,
    actorId: actorId || null,
    payload: { sku, updates, note: note || "Admin updated payment details" },
  });

  return {
    sku,
    ...updates,
    currentStatus: asset.currentStatus, // Status remains unchanged!
  };
}

export async function updateAssetFee(
  sku: string,
  newFeeAmount: string,
  actorId?: string,
  note?: string
) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const oldFee = asset.feeAmount;

  // Update fee without changing currentStatus
  await db
    .update(assets)
    .set({
      feeAmount: newFeeAmount,
      updatedAt: new Date(),
    })
    .where(eq(assets.id, asset.id));

  // Record audit log entry
  await db.insert(auditLog).values({
    action: "updateAssetFee",
    entityType: "asset",
    entityId: asset.id,
    actorId: actorId || null,
    payload: { sku, oldFee, newFee: newFeeAmount, note: note || "Mid-production fee update" },
  });

  return {
    sku,
    oldFee,
    newFee: newFeeAmount,
    currentStatus: asset.currentStatus, // Status remains unchanged!
  };
}
