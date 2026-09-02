// Admin CRUD for the forms engine.
//
// The form_definitions / form_fields tables were built to be config-driven — "add, rename, or
// retire fields at any time without breaking existing records" — but the only way to get a form
// into them was to write a seeder in code (lib/forms/onboarding.ts,
// lib/knowledge/artifact-submission.ts) and redeploy. That is the same gap the curation field
// config already closed for curation: the table was editable, the UI to edit it was missing.
//
// Field values live in form_submissions.values as JSONB keyed by field_key, so adding, renaming
// or retiring a field here never needs a migration, and submissions recorded under an old field
// key stay readable.

import { db } from "@/lib/db/client";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { formFields } from "@/lib/db/schema/form_fields";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { and, asc, count, desc, eq, max } from "drizzle-orm";

export const FIELD_TYPES = ["text", "textarea", "select", "multi_select", "url", "image", "file"] as const;
export type FormFieldType = (typeof FIELD_TYPES)[number];

export const SUBMISSION_BEHAVIORS = [
  "record_only",
  "trigger_personnel_onboarding",
  "trigger_artifact_creation",
] as const;
export type SubmissionBehavior = (typeof SUBMISSION_BEHAVIORS)[number];

// A field key becomes a JSONB object key in form_submissions.values, and the submit path uses it
// to decide which posted values are real. Restricting it to an identifier keeps those keys
// predictable and keeps a renamed field from colliding with a differently-cased old one.
const FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const FORM_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface FormSummary {
  id: string;
  key: string;
  title: string;
  description: string | null;
  targetRoles: string[];
  onSubmissionBehavior: string;
  isActive: boolean;
  fieldCount: number;
  submissionCount: number;
}

/** Lists every form with its field and submission counts, newest first. */
export async function listForms(): Promise<FormSummary[]> {
  // Grouped counts rather than a count per form, so this stays three queries regardless of how
  // many forms exist — and all three are independent, so they go together.
  const [defs, fieldCounts, submissionCounts] = await Promise.all([
    db.select().from(formDefinitions).orderBy(desc(formDefinitions.createdAt)),
    db.select({ formId: formFields.formDefinitionId, n: count() }).from(formFields).groupBy(formFields.formDefinitionId),
    db.select({ formId: formSubmissions.formDefinitionId, n: count() }).from(formSubmissions).groupBy(formSubmissions.formDefinitionId),
  ]);
  const fieldsBy = new Map(fieldCounts.map((r) => [r.formId, Number(r.n)]));
  const subsBy = new Map(submissionCounts.map((r) => [r.formId, Number(r.n)]));

  return defs.map((d) => ({
    id: d.id,
    key: d.key,
    title: d.title,
    description: d.description,
    targetRoles: d.targetRoles || [],
    onSubmissionBehavior: d.onSubmissionBehavior,
    isActive: d.isActive,
    fieldCount: fieldsBy.get(d.id) ?? 0,
    submissionCount: subsBy.get(d.id) ?? 0,
  }));
}

/** Returns one form with its fields in sort order, or null if there is no such form. */
export async function getFormById(formId: string) {
  const [definition] = await db.select().from(formDefinitions).where(eq(formDefinitions.id, formId)).limit(1);
  if (!definition) return null;
  const fields = await db
    .select()
    .from(formFields)
    .where(eq(formFields.formDefinitionId, formId))
    .orderBy(asc(formFields.sortOrder));
  return { definition, fields };
}

export interface CreateFormInput {
  key: string;
  title: string;
  description?: string;
  targetRoles?: string[];
  onSubmissionBehavior?: SubmissionBehavior;
}

export async function createForm(input: CreateFormInput) {
  const key = input.key.trim();
  if (!FORM_KEY_PATTERN.test(key)) {
    throw new Error("Form key must start with a letter and contain only lowercase letters, digits and underscores");
  }
  if (!input.title.trim()) throw new Error("Form title is required");

  const [existing] = await db.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, key)).limit(1);
  if (existing) throw new Error(`A form with the key '${key}' already exists`);

  const [created] = await db
    .insert(formDefinitions)
    .values({
      key,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      // Empty means public, per form_definitions' own column comment and the check both form
      // routes make. Anything else requires a session carrying one of these roles.
      targetRoles: input.targetRoles || [],
      onSubmissionBehavior: input.onSubmissionBehavior || "record_only",
    })
    .returning();
  return created;
}

export interface UpdateFormInput {
  title?: string;
  description?: string | null;
  targetRoles?: string[];
  onSubmissionBehavior?: SubmissionBehavior;
  isActive?: boolean;
}

// The key is deliberately not updatable. Code seeds and route URLs address forms by key
// (ARTIST_ACCESS_FORM_KEY, /apply, /api/forms/[formKey]), so renaming one would break whichever
// of those points at it, silently and only at request time.
export async function updateForm(formId: string, input: UpdateFormInput) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new Error("Form title cannot be empty");
    patch.title = input.title.trim();
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.targetRoles !== undefined) patch.targetRoles = input.targetRoles;
  if (input.onSubmissionBehavior !== undefined) patch.onSubmissionBehavior = input.onSubmissionBehavior;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  const [row] = await db.update(formDefinitions).set(patch).where(eq(formDefinitions.id, formId)).returning();
  if (!row) throw new Error("Form not found");
  return row;
}

/**
 * Deactivates a form. Never deletes it.
 *
 * Input: the form id. Output: the updated row.
 * form_submissions cascades on delete, so removing a form would take every response people have
 * already given with it. Deactivating hides it from getFormDefinitionByKey (which returns null
 * for an inactive form) while leaving the submissions readable.
 */
export async function deactivateForm(formId: string) {
  return updateForm(formId, { isActive: false });
}

export interface AddFieldInput {
  formId: string;
  fieldKey: string;
  label: string;
  fieldType: FormFieldType;
  isRequired?: boolean;
  options?: string[];
  sortOrder?: number;
}

export async function addField(input: AddFieldInput) {
  const fieldKey = input.fieldKey.trim();
  if (!FIELD_KEY_PATTERN.test(fieldKey)) {
    throw new Error("Field key must start with a letter and contain only letters, digits and underscores");
  }
  if (!input.label.trim()) throw new Error("Field label is required");
  if (!FIELD_TYPES.includes(input.fieldType)) throw new Error(`Unknown field type '${input.fieldType}'`);

  const [duplicate] = await db
    .select({ id: formFields.id })
    .from(formFields)
    .where(and(eq(formFields.formDefinitionId, input.formId), eq(formFields.fieldKey, fieldKey)))
    .limit(1);
  if (duplicate) throw new Error(`This form already has a field keyed '${fieldKey}'`);

  // Append to the end unless told otherwise, so adding a field never reshuffles the form.
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const [{ highest }] = await db
      .select({ highest: max(formFields.sortOrder) })
      .from(formFields)
      .where(eq(formFields.formDefinitionId, input.formId));
    sortOrder = (highest ?? 0) + 1;
  }

  const [created] = await db
    .insert(formFields)
    .values({
      formDefinitionId: input.formId,
      fieldKey,
      label: input.label.trim(),
      fieldType: input.fieldType,
      isRequired: input.isRequired ?? false,
      options: input.options || [],
      sortOrder,
    })
    .returning();
  return created;
}

export interface UpdateFieldInput {
  label?: string;
  fieldType?: FormFieldType;
  isRequired?: boolean;
  options?: string[];
  sortOrder?: number;
}

// fieldKey is not updatable for the same reason a form key is not: it is the JSONB key every
// existing submission's values are recorded under, so renaming it would orphan them. Change the
// label instead — that is what people actually see.
export async function updateField(fieldId: string, input: UpdateFieldInput) {
  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) {
    if (!input.label.trim()) throw new Error("Field label cannot be empty");
    patch.label = input.label.trim();
  }
  if (input.fieldType !== undefined) {
    if (!FIELD_TYPES.includes(input.fieldType)) throw new Error(`Unknown field type '${input.fieldType}'`);
    patch.fieldType = input.fieldType;
  }
  if (input.isRequired !== undefined) patch.isRequired = input.isRequired;
  if (input.options !== undefined) patch.options = input.options;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  if (Object.keys(patch).length === 0) throw new Error("Nothing to update");

  const [row] = await db.update(formFields).set(patch).where(eq(formFields.id, fieldId)).returning();
  if (!row) throw new Error("Field not found");
  return row;
}

/**
 * Removes a field from a form.
 *
 * Input: the field id. Output: the removed field's key.
 * Values already recorded under this key stay in form_submissions.values — they are JSONB, not
 * columns, so dropping the field definition does not touch them. That is the point of storing
 * answers this way, and why retiring a field needs no migration.
 */
export async function removeField(fieldId: string) {
  const [row] = await db.delete(formFields).where(eq(formFields.id, fieldId)).returning();
  if (!row) throw new Error("Field not found");
  return { fieldKey: row.fieldKey };
}

/** Rewrites the sort order of a form's fields to match the given id order. */
export async function reorderFields(formId: string, orderedFieldIds: string[]) {
  await Promise.all(
    orderedFieldIds.map((fieldId, i) =>
      db
        .update(formFields)
        .set({ sortOrder: i + 1 })
        .where(and(eq(formFields.id, fieldId), eq(formFields.formDefinitionId, formId)))
    )
  );
  return { reordered: orderedFieldIds.length };
}

/** Reads one form's submissions, newest first, for the review table. */
export async function listSubmissions(formId: string, limit = 100) {
  return db
    .select()
    .from(formSubmissions)
    .where(eq(formSubmissions.formDefinitionId, formId))
    .orderBy(desc(formSubmissions.createdAt))
    .limit(limit);
}
