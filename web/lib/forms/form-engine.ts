import { db } from "@/lib/db/client";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { formFields } from "@/lib/db/schema/form_fields";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { eq, asc, sql } from "drizzle-orm";

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormFieldConfig {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: "text" | "textarea" | "select" | "multi_select" | "url" | "image" | "file";
  sortOrder: number;
  isRequired: boolean;
  options: FormFieldOption[];
  validationRules: Record<string, any>;
}

export interface FormDefinitionWithFields {
  id: string;
  key: string;
  title: string;
  description: string | null;
  targetRoles: string[];
  onSubmissionBehavior: string;
  isActive: boolean;
  fields: FormFieldConfig[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export async function getFormDefinitionWithFields(formKey: string): Promise<FormDefinitionWithFields | null> {
  const defs = await db.select().from(formDefinitions).where(eq(formDefinitions.key, formKey)).limit(1);
  if (defs.length === 0) return null;

  const def = defs[0];
  const fields = await db
    .select()
    .from(formFields)
    .where(eq(formFields.formDefinitionId, def.id))
    .orderBy(asc(formFields.sortOrder));

  return {
    id: def.id,
    key: def.key,
    title: def.title,
    description: def.description,
    targetRoles: def.targetRoles || [],
    onSubmissionBehavior: def.onSubmissionBehavior,
    isActive: def.isActive,
    fields: fields.map((f) => ({
      id: f.id,
      fieldKey: f.fieldKey,
      label: f.label,
      fieldType: f.fieldType as FormFieldConfig["fieldType"],
      sortOrder: f.sortOrder,
      isRequired: f.isRequired,
      options: (f.options as FormFieldOption[]) || [],
      validationRules: (f.validationRules as Record<string, any>) || {},
    })),
  };
}

export function validateFormValues(fields: FormFieldConfig[], values: Record<string, any>): ValidationResult {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const val = values[field.fieldKey];

    // Required check
    if (field.isRequired) {
      if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) {
        errors[field.fieldKey] = `${field.label} is required`;
        continue;
      }
    }

    if (val !== undefined && val !== null && val !== "") {
      // URL validation check
      if (field.fieldType === "url") {
        try {
          new URL(String(val));
        } catch {
          errors[field.fieldKey] = `${field.label} must be a valid URL`;
        }
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

// Admin form-builder CRUD (P2-T8 UI backing) - the pieces getFormDefinitionWithFields/
// submitFormData above didn't need but the admin list/create/edit UI does.

export interface FormDefinitionSummary {
  id: string;
  key: string;
  title: string;
  description: string | null;
  isActive: boolean;
  fieldCount: number;
}

export async function listFormDefinitions(): Promise<FormDefinitionSummary[]> {
  const rows = await db
    .select({
      id: formDefinitions.id,
      key: formDefinitions.key,
      title: formDefinitions.title,
      description: formDefinitions.description,
      isActive: formDefinitions.isActive,
      fieldCount: sql<number>`count(${formFields.id})::int`,
    })
    .from(formDefinitions)
    .leftJoin(formFields, eq(formFields.formDefinitionId, formDefinitions.id))
    .groupBy(formDefinitions.id)
    .orderBy(asc(formDefinitions.title));

  return rows;
}

export interface CreateFormDefinitionInput {
  key: string;
  title: string;
  description?: string;
  targetRoles?: string[];
  onSubmissionBehavior?: string;
}

export async function createFormDefinition(input: CreateFormDefinitionInput) {
  const [row] = await db.insert(formDefinitions).values(input).returning();
  return row;
}

export interface AddFormFieldInput {
  formDefinitionId: string;
  fieldKey: string;
  label: string;
  fieldType: FormFieldConfig["fieldType"];
  isRequired?: boolean;
  options?: FormFieldOption[];
}

export async function addFormField(input: AddFormFieldInput) {
  const existing = await db
    .select({ sortOrder: formFields.sortOrder })
    .from(formFields)
    .where(eq(formFields.formDefinitionId, input.formDefinitionId));
  const nextSortOrder = existing.reduce((max, f) => Math.max(max, f.sortOrder), 0) + 1;

  const [row] = await db
    .insert(formFields)
    .values({ ...input, sortOrder: nextSortOrder, options: input.options || [] })
    .returning();
  return row;
}

export async function deleteFormField(fieldId: string) {
  await db.delete(formFields).where(eq(formFields.id, fieldId));
}

// Bulk-sets sortOrder to match the given field ID order - the whole list is
// passed each time rather than a single up/down swap, since that's what a
// drag-reorder or move-up/down UI naturally produces in one action.
export async function reorderFormFields(formDefinitionId: string, orderedFieldIds: string[]) {
  for (let i = 0; i < orderedFieldIds.length; i++) {
    await db
      .update(formFields)
      .set({ sortOrder: i + 1 })
      .where(eq(formFields.id, orderedFieldIds[i]));
  }
}

export async function submitFormData(
  formKey: string,
  payload: {
    submitterEmail?: string;
    submitterId?: string;
    values: Record<string, any>;
  }
) {
  const formDef = await getFormDefinitionWithFields(formKey);
  if (!formDef) {
    throw new Error(`Form definition '${formKey}' not found`);
  }

  const validation = validateFormValues(formDef.fields, payload.values);
  if (!validation.isValid) {
    throw { status: 400, message: "Validation failed", errors: validation.errors };
  }

  const [submission] = await db
    .insert(formSubmissions)
    .values({
      formDefinitionId: formDef.id,
      submitterEmail: payload.submitterEmail?.toLowerCase() || null,
      submitterId: payload.submitterId || null,
      values: payload.values,
      status: "pending",
    })
    .returning();

  return {
    submissionId: submission.id,
    status: submission.status,
    onSubmissionBehavior: formDef.onSubmissionBehavior,
  };
}
