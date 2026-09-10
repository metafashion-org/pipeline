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
import { isPublicForm } from "./form-access";

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

// Deliberately permissive: enough to reject a typo or a blank, not enough to argue with a real
// address. Anything stricter rejects valid mail for no gain.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const resolvedEmail = (submitterEmail || emailFromValues).trim().toLowerCase();

  // A public form has no session behind it, so the address the submitter types is the only way to
  // reach them afterwards — and every one of these forms exists to be followed up on. Requiring it
  // here rather than in the page means it holds for a direct POST too.
  const isPublic = isPublicForm(form.definition);
  if (isPublic && !submitterId) {
    if (!resolvedEmail) throw new Error("An email address is required so we can get back to you.");
    if (!EMAIL_PATTERN.test(resolvedEmail)) throw new Error(`"${resolvedEmail}" doesn't look like an email address.`);
  }

  const [submission] = await db
    .insert(formSubmissions)
    .values({
      formDefinitionId: form.definition.id,
      submitterEmail: resolvedEmail || null,
      submitterId: submitterId || null,
      values: cleanValues,
      status: "pending",
    })
    .returning();

  const behaviorError = await runSubmissionBehavior(
    form.definition.onSubmissionBehavior,
    submission.id,
    submitterId,
    isPublic
  );

  return { ...submission, behaviorError };
}

/**
 * Runs whatever form_definitions.on_submission_behavior says to do once a submission is stored.
 *
 * Input: the behavior key, the id of the submission just written, and the submitter. Output: null on success, or a message describing why the follow-on action failed.
 *
 * The column was written in two places and read in none, so a form declaring
 * "trigger_artifact_creation" recorded the submission and then did nothing with it, even though
 * processArtifactSubmission was sitting there fully written. The submission row is inserted
 * before this runs, so a failure here costs a follow-on action, never the submitter's input —
 * an admin can retry it from the stored submission.
 */
async function runSubmissionBehavior(
  behavior: string,
  submissionId: string,
  actorId: string | undefined,
  isPublicForm: boolean
): Promise<string | null> {
  try {
    switch (behavior) {
      case "trigger_artifact_creation": {
        // Creating the artifact outright is the intent on a role-gated form, and a way in for
        // anyone who finds the URL on a public one. The form builder now refuses to save that
        // combination, and this refuses to act on it for any row that predates the check — the
        // submission is still recorded, so nothing anyone typed is lost.
        if (isPublicForm) {
          return "This form is public, so it only records submissions. An admin has to give it a role before it can create artifacts.";
        }
        const { processArtifactSubmission } = await import("@/lib/knowledge/artifact-submission");
        await processArtifactSubmission(submissionId, actorId);
        return null;
      }
      case "trigger_personnel_onboarding":
        // Deliberately does nothing automatic. The Artist Access Request form is public and
        // unauthenticated, so onboarding on submit would let anyone grant themselves an
        // artist account. The submission stays 'pending' for the admin review path that
        // already exists (approveArtistAccessSubmission, /admin/personnel), which is where a
        // person actually becomes personnel.
        return null;
      case "record_only":
      default:
        return null;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[forms] on-submission behavior '${behavior}' failed for submission ${submissionId}:`, message);
    return message;
  }
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
