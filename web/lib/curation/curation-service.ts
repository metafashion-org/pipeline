import { db } from "@/lib/db/client";
import { curationFieldConfig } from "@/lib/db/schema/curation_field_config";
import { curationItemIdeas } from "@/lib/db/schema/curation_item_ideas";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, asc, and, like } from "drizzle-orm";
import { nextSequentialSku } from "@/lib/assets/sku";

export type CurationFieldType = "text" | "textarea" | "select" | "multi_select" | "url" | "image" | "number";

export interface CreateCurationFieldOptions {
  fieldKey: string;
  displayName: string;
  fieldType?: CurationFieldType;
  options?: string[];
  includeInArtistEmail?: boolean;
  sortOrder?: number;
  // Categories this field applies to. Omit or pass an empty array for "every category".
  appliesToCategories?: string[];
}

export async function addCurationFieldConfig(options: CreateCurationFieldOptions) {
  const { fieldKey, displayName, fieldType = "text", options: choices = [], includeInArtistEmail = true, sortOrder = 0, appliesToCategories } = options;

  const [field] = await db
    .insert(curationFieldConfig)
    .values({
      fieldKey,
      displayName,
      fieldType,
      options: choices,
      includeInArtistEmail,
      sortOrder,
      appliesToCategories: appliesToCategories && appliesToCategories.length > 0 ? appliesToCategories : null,
    })
    .returning();

  return field;
}

// Pass includeInactive when the caller needs to RESOLVE historical values
// (e.g. rendering a past idea that used a since-retired field) rather than
// render a blank form for new input, which should only offer live fields.
//
// Pass a category to get only the fields that apply to it. A row with a null or empty
// appliesToCategories applies to every category, which is what every pre-scoping row means —
// so an unscoped config behaves exactly as it did before category scoping existed.
export async function getCurationFieldConfigs(includeInactive = false, category?: string | null) {
  const rows = await db
    .select()
    .from(curationFieldConfig)
    .where(includeInactive ? undefined : eq(curationFieldConfig.isActive, true))
    .orderBy(asc(curationFieldConfig.sortOrder));

  if (!category) return rows;
  return rows.filter((r) => appliesToCategory(r.appliesToCategories, category));
}

/**
 * Whether a field configured for these categories should show for this one.
 *
 * Input: the field's appliesToCategories (null/empty means unscoped) and the category being curated. Output: true when the field belongs on that form.
 * Compared case-insensitively because category values are free text typed by curators, not an enum.
 */
export function appliesToCategory(configured: string[] | null, category: string): boolean {
  if (!configured || configured.length === 0) return true;
  const wanted = category.trim().toLowerCase();
  return configured.some((c) => c.trim().toLowerCase() === wanted);
}

export interface UpdateCurationFieldConfigInput {
  includeInArtistEmail?: boolean;
  displayName?: string;
  sortOrder?: number;
  isActive?: boolean;
  appliesToCategories?: string[] | null;
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
  // Keyed 'recolorInstructions' until now, while the seeded field key is 'recolorDirections'.
  // The two never matched, so this accessor could not fire and recolor reference images never
  // reached an artist brief.
  recolorDirections: (asset) => {
    const recolors = (asset.recolorReferenceImages as Array<{ externalId: string }> | null) || [];
    return recolors.length > 0 ? recolors.map((r) => r.externalId).join(", ") : null;
  },
  // Budget had no accessor, so the brief fell through to the curation-time value in
  // fieldValues and never showed the result of updateAssetFee. That contradicted this map's
  // own reason for existing: a fee changed after assignment should appear in the brief.
  budget: (asset) => (asset.feeAmount ? `${asset.feeAmount}${asset.currency ? ` ${asset.currency}` : ""}` : null),
};

/**
 * Field keys whose value lives in a typed column on `assets`, not in field_values JSONB.
 *
 * This is what resolves the duplication: the curation_field_config row still owns the field's
 * label, ordering and whether it reaches the artist brief, but the value is written once, to the
 * column, by a first-class typed input — never a second time as a string into JSONB. The curation
 * form skips these (getCurationFormFields), and getBriefFieldsForAsset reads them through the
 * accessor above, so an edit made after curation (updateAssetFee, a changed deadline) is what the
 * brief shows.
 */
export const ASSET_BACKED_FIELD_KEYS: ReadonlySet<string> = new Set(Object.keys(ASSET_FIELD_ACCESSORS));

/**
 * The dynamic fields the curation form should render.
 *
 * Input: an optional category to scope to. Output: the active configured fields minus the ones backed by a real asset column, which the form collects as typed inputs of their own.
 */
export async function getCurationFormFields(category?: string | null) {
  const rows = await getCurationFieldConfigs(false, category);
  return rows.filter((r) => !ASSET_BACKED_FIELD_KEYS.has(r.fieldKey));
}

export interface BriefField {
  key: string;
  displayName: string;
  value: string;
}

// Returns the ordered list of optional brief fields to include in an assignment
// email for this asset, per the admin-toggleable curation_field_config table.
// Resolves every curation field flagged includeInArtistEmail for a real
// asset. Two sources, asset columns preferred: a handful of fields
// (deadline, recolor instructions) have a real backing column on `assets`
// that can change after curation — an artist manager editing the deadline
// post-assignment should show up in the brief, not the value captured at
// curation time. Every other dynamic field (rig, tech specs, target wearer,
// etc.) only ever lived in the originating curation idea's fieldValues
// JSONB, found via curationItemIdeas.assetId — see submitCurationItemIdea.
export async function getBriefFieldsForAsset(assetId: string): Promise<BriefField[]> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) throw new Error(`Asset '${assetId}' not found`);

  const [idea] = await db.select().from(curationItemIdeas).where(eq(curationItemIdeas.assetId, assetId)).limit(1);
  const ideaFieldValues = (idea?.fieldValues as Record<string, unknown>) || {};

  const configs = await db
    .select()
    .from(curationFieldConfig)
    .where(and(eq(curationFieldConfig.includeInArtistEmail, true), eq(curationFieldConfig.isActive, true)))
    .orderBy(asc(curationFieldConfig.sortOrder));

  const fields: BriefField[] = [];
  for (const config of configs) {
    const accessor = ASSET_FIELD_ACCESSORS[config.fieldKey];
    const accessorValue = accessor ? accessor(asset) : null;
    if (accessorValue) {
      fields.push({ key: config.fieldKey, displayName: config.displayName, value: accessorValue });
      continue;
    }
    const raw = ideaFieldValues[config.fieldKey];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    if (value) fields.push({ key: config.fieldKey, displayName: config.displayName, value });
  }
  return fields;
}

// Seeded from the brief's §6 field list as real starting data. Admin-editable
// from here on (add / rename / retire), which is the actual point — this is a
// starting set, not a fixed one. includeInArtistEmail is set per the brief's
// own distinction: internal strategy fields (trend reasoning, why it will
// sell, comparable items) stay hidden from artists; production fields (rig,
// tech specs, recolor directions, budget) go in the brief.
export async function seedDefaultCurationFieldConfig() {
  const defaults: CreateCurationFieldOptions[] = [
    { fieldKey: "sourcePlatform", displayName: "Source Platform", fieldType: "text", includeInArtistEmail: false, sortOrder: 1 },
    { fieldKey: "trendReasoning", displayName: "Trend Reasoning", fieldType: "textarea", includeInArtistEmail: false, sortOrder: 2 },
    { fieldKey: "whyItWillSell", displayName: "Why The Item Will Sell", fieldType: "textarea", includeInArtistEmail: false, sortOrder: 3 },
    { fieldKey: "targetWearer", displayName: "Target Wearer / Aesthetic", fieldType: "text", includeInArtistEmail: true, sortOrder: 4 },
    { fieldKey: "seasonality", displayName: "Seasonality", fieldType: "select", options: ["Year-round", "Spring", "Summer", "Autumn", "Winter", "Holiday", "Event-specific"], includeInArtistEmail: true, sortOrder: 5 },
    { fieldKey: "comparableItems", displayName: "Comparable Roblox Items", fieldType: "textarea", includeInArtistEmail: false, sortOrder: 6 },
    // Budget and Deadline stay configured here, but as ASSET-BACKED fields (see
    // ASSET_FIELD_ACCESSORS): the row controls their display name, ordering and whether they go
    // in the artist brief, while the value itself is read from the asset's own typed column.
    // They are deliberately NOT rendered as dynamic form inputs — see getCurationFormFields.
    { fieldKey: "budget", displayName: "Budget", fieldType: "number", includeInArtistEmail: true, sortOrder: 7 },
    { fieldKey: "rig", displayName: "Rig", fieldType: "text", includeInArtistEmail: true, sortOrder: 8 },
    { fieldKey: "technicalSpecs", displayName: "Technical Specs", fieldType: "textarea", includeInArtistEmail: true, sortOrder: 9 },
    { fieldKey: "recolorDirections", displayName: "Recolor Directions", fieldType: "textarea", includeInArtistEmail: true, sortOrder: 10 },
    { fieldKey: "deadline", displayName: "Deadline", fieldType: "text", includeInArtistEmail: true, sortOrder: 11 },
    { fieldKey: "notes", displayName: "Notes", fieldType: "textarea", includeInArtistEmail: true, sortOrder: 12 },
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


/**
 * Inserts an asset under the next free sequential SKU for the current year.
 *
 * Input: the asset's columns except its SKU. Output: the inserted row.
 *
 * The SKU is derived by reading the ones already issued, which is a read-then-write with no
 * lock: two curators submitting at the same moment computed the same number and one insert
 * died on the unique constraint with a raw Postgres error. Retrying on exactly that violation
 * is what makes concurrent submits safe, and is cheaper than serialising every submit behind a
 * lock for a collision this rare. The scan is also narrowed to this year's prefix rather than
 * reading every SKU in the table.
 */
async function insertAssetWithNextSku(
  values: Omit<typeof assets.$inferInsert, "sku">
): Promise<typeof assets.$inferSelect> {
  const year = new Date().getFullYear();
  const MAX_ATTEMPTS = 5;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const issued = await db
      .select({ sku: assets.sku })
      .from(assets)
      .where(like(assets.sku, `MF-${year}-%`));
    const sku = nextSequentialSku(issued.map((a) => a.sku), year);

    try {
      const [asset] = await db.insert(assets).values({ ...values, sku }).returning();
      return asset;
    } catch (error: unknown) {
      // 23505 is unique_violation. Anything else is a real failure and must surface.
      const code = (error as { code?: string })?.code;
      if (code !== "23505" || attempt === MAX_ATTEMPTS) throw error;
    }
  }

  throw new Error(`Could not allocate a free SKU for ${year} after ${MAX_ATTEMPTS} attempts`);
}

export interface SubmitItemIdeaOptions {
  ideaTitle: string;
  category?: string;
  trendReasoning?: string;
  sourceLinks?: string[];
  moodboardUrls?: string[];
  // Values for the dynamic fields defined in curation_field_config, keyed by
  // fieldKey. Not validated against the config here on purpose: a field
  // retired between form render and submit should still save rather than
  // hard-fail the curator's work.
  fieldValues?: Record<string, unknown>;
  // Graduated first-class values, written straight to the asset's own typed columns. Optional
  // because in-flight drafts saved before these were first-class still carry them inside
  // fieldValues; submitCurationItemIdea falls back to that so no draft loses its numbers.
  budget?: string | number;
  deadline?: string;
  submitterId?: string;
  // When submitting from an existing draft (see lib/curation/draft-service.ts),
  // the draft row IS converted in place (status draft -> approved) rather
  // than inserted as a second, separate row - a draft and its final
  // submission are the same idea, not two records that both need cleaning up.
  draftId?: string;
}

export async function submitCurationItemIdea(options: SubmitItemIdeaOptions) {
  const { ideaTitle, category, trendReasoning, sourceLinks = [], moodboardUrls = [], fieldValues = {}, budget, deadline, submitterId, draftId } = options;

  // First-class value wins; the fieldValues copy is the pre-graduation fallback.
  const rawBudget = budget ?? fieldValues.budget;
  const feeAmount = typeof rawBudget === "number" || (typeof rawBudget === "string" && rawBudget.trim() !== "")
    ? String(rawBudget)
    : null;
  const rawDeadline = deadline ?? fieldValues.deadline;
  const deadlineDate = typeof rawDeadline === "string" && rawDeadline.trim() !== "" && !isNaN(Date.parse(rawDeadline))
    ? new Date(rawDeadline)
    : null;

  // 1. Record item idea - convert the existing draft row in place if one was
  // supplied (and really belongs to this submitter and is still a draft),
  // otherwise insert fresh, exactly as before drafts existed.
  let idea: typeof curationItemIdeas.$inferSelect;
  if (draftId) {
    const [existingDraft] = await db
      .select()
      .from(curationItemIdeas)
      .where(and(eq(curationItemIdeas.id, draftId), eq(curationItemIdeas.status, "draft")))
      .limit(1);
    if (!existingDraft) throw new Error("Draft not found or already submitted");
    if (submitterId && existingDraft.submittedBy && existingDraft.submittedBy !== submitterId) {
      throw new Error("This draft belongs to someone else");
    }
    const [converted] = await db
      .update(curationItemIdeas)
      .set({
        ideaTitle,
        category: category || null,
        trendReasoning: trendReasoning || null,
        sourceLinks,
        moodboardUrls,
        fieldValues,
        submittedBy: submitterId || existingDraft.submittedBy,
        status: "approved",
        updatedAt: new Date(),
      })
      .where(eq(curationItemIdeas.id, draftId))
      .returning();
    idea = converted;
  } else {
    const [inserted] = await db
      .insert(curationItemIdeas)
      .values({
        ideaTitle,
        category: category || null,
        trendReasoning: trendReasoning || null,
        sourceLinks,
        moodboardUrls,
        fieldValues,
        submittedBy: submitterId || null,
        status: "approved",
      })
      .returning();
    idea = inserted;
  }

  // 2. Auto-generate SKU and create asset at 'unassigned'.
  // Uses the SAME sequential scheme as every other asset (MF-<year>-<4 digits>)
  // rather than the old `SKU-IDEA-<timestamp>` format this used to produce —
  // that matched neither the live SKUs nor the admin-created ones, which is
  // exactly the bug lib/assets/sku.ts was written to fix for the admin path
  // and which curation was silently left behind on.
  const asset = await insertAssetWithNextSku({
    itemName: ideaTitle,
    category: category || null,
    currentStatus: "unassigned",
    // The brief's §6 lists Budget and Deadline as curation fields, and the
    // Kanban card reads them off the asset — carry them across at creation
    // so a curated idea arrives on the board already showing them.
    feeAmount,
    deadline: deadlineDate,
    referenceImages: moodboardUrls.map((url) => ({ provider: "filestore", externalId: url })),
  });

  // 2b. Link the idea back to the asset it created — this is what lets
  // getBriefFieldsForAsset find this idea's dynamic field values again once
  // only the asset (not the idea) is visible from the Kanban side.
  await db.update(curationItemIdeas).set({ assetId: asset.id }).where(eq(curationItemIdeas.id, idea.id));

  // 3. Log audit event
  await db.insert(auditLog).values({
    action: "submitCurationItemIdea",
    entityType: "asset",
    entityId: asset.id,
    actorId: submitterId || null,
    payload: { ideaId: idea.id, sku: asset.sku, ideaTitle },
  });

  return { idea, asset, sku: asset.sku, currentStatus: "unassigned" };
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

export const SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "RUB"] as const;
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
