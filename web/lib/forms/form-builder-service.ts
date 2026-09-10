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
import { formDefinitions, FORM_AUDIENCES, type FormAudience } from "@/lib/db/schema/form_definitions";
import { formFields } from "@/lib/db/schema/form_fields";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { personnel } from "@/lib/db/schema/personnel";
import { and, asc, count, desc, eq, max } from "drizzle-orm";
import { normalizeAudience } from "./form-access";

export const FIELD_TYPES = ["text", "textarea", "select", "multi_select", "url", "image", "file"] as const;
export type FormFieldType = (typeof FIELD_TYPES)[number];

export { FORM_AUDIENCES };
export type { FormAudience };

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
  audience: FormAudience;
  targetRoles: string[];
  allowedEmails: string[];
  onSubmissionBehavior: string;
  isActive: boolean;
  fieldCount: number;
  submissionCount: number;
  createdByName: string | null;
  createdAt: string;
}

/** Lists every form with its field and submission counts, newest first. */
export async function listForms(): Promise<FormSummary[]> {
  // Grouped counts rather than a count per form, so this stays three queries regardless of how
  // many forms exist — and all three are independent, so they go together.
  const [defs, fieldCounts, submissionCounts] = await Promise.all([
    // Joined to personnel so the list can say who built each form. "Who created it" was not
    // recorded at all before, so a form nobody recognised had no way of being traced.
    db
      .select({ form: formDefinitions, createdByName: personnel.name })
      .from(formDefinitions)
      .leftJoin(personnel, eq(formDefinitions.createdBy, personnel.id))
      .orderBy(desc(formDefinitions.createdAt)),
    db.select({ formId: formFields.formDefinitionId, n: count() }).from(formFields).groupBy(formFields.formDefinitionId),
    db.select({ formId: formSubmissions.formDefinitionId, n: count() }).from(formSubmissions).groupBy(formSubmissions.formDefinitionId),
  ]);
  const fieldsBy = new Map(fieldCounts.map((r) => [r.formId, Number(r.n)]));
  const subsBy = new Map(submissionCounts.map((r) => [r.formId, Number(r.n)]));

  return defs.map(({ form: d, createdByName }) => ({
    id: d.id,
    key: d.key,
    title: d.title,
    description: d.description,
    audience: normalizeAudience(d),
    targetRoles: d.targetRoles || [],
    allowedEmails: d.allowedEmails || [],
    onSubmissionBehavior: d.onSubmissionBehavior,
    isActive: d.isActive,
    fieldCount: fieldsBy.get(d.id) ?? 0,
    submissionCount: subsBy.get(d.id) ?? 0,
    createdByName,
    createdAt: d.createdAt.toISOString(),
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
  audience?: FormAudience;
  targetRoles?: string[];
  allowedEmails?: string[];
  onSubmissionBehavior?: SubmissionBehavior;
  createdBy?: string;
}

/**
 * Cleans and lowercases an address list.
 *
 * Input: whatever the caller sent. Output: unique, lowercase, non-empty addresses.
 * Stored lowercase because the check compares against a session address, and mail addresses are not case-sensitive in the part anyone actually types differently.
 */
function normalizeEmails(emails: string[] | undefined): string[] {
  if (!emails) return [];
  const seen = new Set<string>();
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

/**
 * Rejects a combination that would let anyone with the link create records outright.
 *
 * Input: the behavior the form runs on submit, and the roles allowed to fill it (empty means public). Output: nothing on success; throws with the reason otherwise.
 *
 * `trigger_artifact_creation` writes a knowledge artifact the moment a submission lands, with no review step. runSubmissionBehavior's own comment says that is only intended on a role-gated form, but nothing enforced it, and the seeded artifact_submission form was in fact sitting on target_roles = [] in production — an open URL that created registry rows for whoever found it.
 */
function assertBehaviorMatchesAudience(behavior: string | undefined, audience: FormAudience) {
  if (behavior !== "trigger_artifact_creation") return;
  if (audience === "public") {
    throw new Error(
      "A form that creates knowledge artifacts on submit can't be public. Restrict it to roles or to a list of addresses first."
    );
  }
}

/**
 * Checks that the audience a form declares has the information it needs to be enforced.
 *
 * Input: the audience and both lists. Output: nothing on success; throws with what is missing otherwise.
 * A form set to 'roles' with no roles, or to 'emails' with no addresses, is answerable by nobody — a state worth refusing at save time rather than discovering when the first person opens the link.
 */
function assertAudienceIsComplete(audience: FormAudience, targetRoles: string[], allowedEmails: string[]) {
  if (audience === "roles" && targetRoles.length === 0) {
    throw new Error("Pick at least one role, or set the form to public.");
  }
  if (audience === "emails" && allowedEmails.length === 0) {
    throw new Error("Add at least one email address, or set the form to public.");
  }
}

export async function createForm(input: CreateFormInput) {
  const key = input.key.trim();
  if (!FORM_KEY_PATTERN.test(key)) {
    throw new Error("Form key must start with a letter and contain only lowercase letters, digits and underscores");
  }
  if (!input.title.trim()) throw new Error("Form title is required");

  const audience = input.audience || "public";
  const targetRoles = input.targetRoles || [];
  const allowedEmails = normalizeEmails(input.allowedEmails);
  assertAudienceIsComplete(audience, targetRoles, allowedEmails);
  assertBehaviorMatchesAudience(input.onSubmissionBehavior, audience);

  const [existing] = await db.select({ id: formDefinitions.id }).from(formDefinitions).where(eq(formDefinitions.key, key)).limit(1);
  if (existing) throw new Error(`A form with the key '${key}' already exists`);

  const [created] = await db
    .insert(formDefinitions)
    .values({
      key,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      audience,
      targetRoles,
      allowedEmails,
      onSubmissionBehavior: input.onSubmissionBehavior || "record_only",
      createdBy: input.createdBy || null,
    })
    .returning();
  return created;
}

export interface UpdateFormInput {
  title?: string;
  description?: string | null;
  audience?: FormAudience;
  targetRoles?: string[];
  allowedEmails?: string[];
  onSubmissionBehavior?: SubmissionBehavior;
  isActive?: boolean;
}

// The key is deliberately not updatable. Code seeds and route URLs address forms by key
// (ARTIST_ACCESS_FORM_KEY, /apply, /api/forms/[formKey]), so renaming one would break whichever
// of those points at it, silently and only at request time.
export async function updateForm(formId: string, input: UpdateFormInput) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  // Any one of these can arrive on its own — making an artifact-creating form public, switching a
  // public form to artifact creation, emptying the role list — so both checks run against the row
  // as it will be after this patch, not against the patch alone.
  if (
    input.onSubmissionBehavior !== undefined ||
    input.audience !== undefined ||
    input.targetRoles !== undefined ||
    input.allowedEmails !== undefined
  ) {
    const [current] = await db
      .select()
      .from(formDefinitions)
      .where(eq(formDefinitions.id, formId))
      .limit(1);
    if (!current) throw new Error("Form not found");
    const audience = input.audience ?? normalizeAudience(current);
    const roles = input.targetRoles ?? current.targetRoles ?? [];
    const emails = input.allowedEmails !== undefined ? normalizeEmails(input.allowedEmails) : current.allowedEmails ?? [];
    assertAudienceIsComplete(audience, roles, emails);
    assertBehaviorMatchesAudience(input.onSubmissionBehavior ?? current.onSubmissionBehavior, audience);
  }
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new Error("Form title cannot be empty");
    patch.title = input.title.trim();
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.audience !== undefined) patch.audience = input.audience;
  if (input.targetRoles !== undefined) patch.targetRoles = input.targetRoles;
  if (input.allowedEmails !== undefined) patch.allowedEmails = normalizeEmails(input.allowedEmails);
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
  section?: string | null;
  helpText?: string | null;
  placeholder?: string | null;
  sortOrder?: number;
}

/** Trims a value and turns an empty one into null, so a cleared box is stored as absent rather than as "". */
function orNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
      section: orNull(input.section),
      helpText: orNull(input.helpText),
      placeholder: orNull(input.placeholder),
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
  section?: string | null;
  helpText?: string | null;
  placeholder?: string | null;
  sortOrder?: number;
}

/**
 * Confirms a field id belongs to the form whose URL it arrived on.
 *
 * Input: the field id and the form id from the route. Output: nothing on success; throws when the field is missing or belongs to a different form.
 * Without this, PATCH and DELETE on /api/admin/forms/<any form>/fields/<field id> edited whichever field the id named, regardless of which form the caller was looking at.
 */
async function assertFieldBelongsToForm(fieldId: string, formId: string) {
  const [row] = await db
    .select({ formDefinitionId: formFields.formDefinitionId })
    .from(formFields)
    .where(eq(formFields.id, fieldId))
    .limit(1);
  if (!row) throw new Error("Field not found");
  if (row.formDefinitionId !== formId) throw new Error("That field belongs to a different form");
}

// fieldKey is not updatable for the same reason a form key is not: it is the JSONB key every
// existing submission's values are recorded under, so renaming it would orphan them. Change the
// label instead — that is what people actually see.
export async function updateField(fieldId: string, formId: string, input: UpdateFieldInput) {
  await assertFieldBelongsToForm(fieldId, formId);
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
  if (input.section !== undefined) patch.section = orNull(input.section);
  if (input.helpText !== undefined) patch.helpText = orNull(input.helpText);
  if (input.placeholder !== undefined) patch.placeholder = orNull(input.placeholder);
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  if (Object.keys(patch).length === 0) throw new Error("Nothing to update");

  const [row] = await db.update(formFields).set(patch).where(eq(formFields.id, fieldId)).returning();
  if (!row) throw new Error("Field not found");
  return row;
}

/**
 * Removes a field from a form.
 *
 * Input: the field id and the form it must belong to. Output: the removed field's key.
 * Values already recorded under this key stay in form_submissions.values — they are JSONB, not
 * columns, so dropping the field definition does not touch them. That is the point of storing
 * answers this way, and why retiring a field needs no migration.
 */
export async function removeField(fieldId: string, formId: string) {
  await assertFieldBelongsToForm(fieldId, formId);
  const [row] = await db.delete(formFields).where(eq(formFields.id, fieldId)).returning();
  if (!row) throw new Error("Field not found");
  return { fieldKey: row.fieldKey };
}

/**
 * Rewrites the order of a form's fields, and optionally which section each one sits in.
 *
 * Input: the form and the fields in their new order. An entry may be a bare id, or an id with the section it now belongs to. Output: how many fields were rewritten.
 *
 * Section travels with order because moving a field between sections in the builder is the same
 * gesture as reordering it. Writing only the order would move the field on screen and snap it
 * back on the next load.
 */
export interface FieldOrderEntry {
  id: string;
  section?: string | null;
}

export async function reorderFields(formId: string, ordered: Array<string | FieldOrderEntry>) {
  await Promise.all(
    ordered.map((entry, i) => {
      const id = typeof entry === "string" ? entry : entry.id;
      const patch: Record<string, unknown> = { sortOrder: i + 1 };
      if (typeof entry !== "string" && entry.section !== undefined) patch.section = orNull(entry.section);
      return db
        .update(formFields)
        .set(patch)
        .where(and(eq(formFields.id, id), eq(formFields.formDefinitionId, formId)));
    })
  );
  return { reordered: ordered.length };
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
