// lib/forms/form-service.ts
// Generic, form-agnostic read/submit logic on top of the form_definitions /
// form_fields / form_submissions tables the original build already had —
// same pattern lib/forms/onboarding.ts uses for the Artist Access Request
// form's approval side, this is the submission side, which had no route or
// UI anywhere despite the approval side (app/admin/personnel/page.tsx,
// approveArtistAccessSubmission) already existing and expecting real
// submissions to review. A form with an approval workflow but no way to
// actually submit it was a real, confirmed dead end.

import { db } from "@/lib/db/client";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { formFields } from "@/lib/db/schema/form_fields";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { eq, asc } from "drizzle-orm";

export async function getFormDefinitionByKey(key: string) {
  const [def] = await db.select().from(formDefinitions).where(eq(formDefinitions.key, key)).limit(1);
  if (!def || !def.isActive) return null;
  const fields = await db.select().from(formFields).where(eq(formFields.formDefinitionId, def.id)).orderBy(asc(formFields.sortOrder));
  return { definition: def, fields };
}

export interface SubmitFormOptions {
  formKey: string;
  values: Record<string, unknown>;
  submitterEmail?: string;
  submitterId?: string;
}

// Validates against the form's OWN real field definitions (required/type),
// not a hardcoded shape — same "dynamic form fields" principle the brief's
// §6 curation form is built on (curation-service.ts), applied here to
// every form on this generic table, not just curation's own separate one.
export async function submitFormResponse(options: SubmitFormOptions) {
  const { formKey, values, submitterEmail, submitterId } = options;
  const form = await getFormDefinitionByKey(formKey);
  if (!form) throw new Error(`Form "${formKey}" not found or not active.`);

  const missing = form.fields.filter((f) => f.isRequired && isEmptyValue(values[f.fieldKey])).map((f) => f.label);
  if (missing.length > 0) {
    throw new Error(`Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  }

  // Only real, declared field keys are stored — an arbitrary payload can't
  // smuggle extra values into a submission the form never asked for.
  const allowedKeys = new Set(form.fields.map((f) => f.fieldKey));
  const cleanValues: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    if (allowedKeys.has(key)) cleanValues[key] = values[key];
  }

  const emailFromValues = typeof cleanValues["email"] === "string" ? (cleanValues["email"] as string).trim() : "";

  const [submission] = await db
    .insert(formSubmissions)
    .values({
      formDefinitionId: form.definition.id,
      submitterEmail: submitterEmail || emailFromValues || null,
      submitterId: submitterId || null,
      values: cleanValues,
      status: "pending",
    })
    .returning();

  return submission;
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
