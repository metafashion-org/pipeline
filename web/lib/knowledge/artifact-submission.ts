import { db } from "@/lib/db/client";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { formFields } from "@/lib/db/schema/form_fields";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { eq } from "drizzle-orm";
import { createKnowledgeArtifact } from "./artifacts-service";
import { linkArtifactToCategory } from "./artifact-links-service";

export const ARTIFACT_SUBMISSION_FORM_KEY = "artifact_submission";

export async function seedArtifactSubmissionFormDefinition() {
  const existing = await db
    .select()
    .from(formDefinitions)
    .where(eq(formDefinitions.key, ARTIFACT_SUBMISSION_FORM_KEY))
    .limit(1);

  let defId = "";
  if (existing.length > 0) {
    defId = existing[0].id;
  } else {
    const [newDef] = await db
      .insert(formDefinitions)
      .values({
        key: ARTIFACT_SUBMISSION_FORM_KEY,
        title: "Knowledge Artifact Submission",
        description: "Submit a reusable tech spec, mannequin rig, recruiting FAQ, or style guide to the Knowledge Registry",
        targetRoles: ["admin", "operator", "curator"],
        onSubmissionBehavior: "trigger_artifact_creation",
        isActive: true,
      })
      .returning();
    defId = newDef.id;
  }

  const fields = [
    { fieldKey: "artifactType", label: "Artifact Type", fieldType: "select" as const, sortOrder: 1, isRequired: true },
    { fieldKey: "title", label: "Title", fieldType: "text" as const, sortOrder: 2, isRequired: false },
    { fieldKey: "category", label: "Theme / Trend / Category", fieldType: "text" as const, sortOrder: 3, isRequired: false },
    { fieldKey: "fileUrl", label: "File URL", fieldType: "url" as const, sortOrder: 4, isRequired: true },
    { fieldKey: "description", label: "Description", fieldType: "textarea" as const, sortOrder: 5, isRequired: false },
  ];

  for (const f of fields) {
    const existingField = await db
      .select()
      .from(formFields)
      .where(eq(formFields.fieldKey, f.fieldKey))
      .limit(1);

    if (existingField.length === 0) {
      await db.insert(formFields).values({
        formDefinitionId: defId,
        fieldKey: f.fieldKey,
        label: f.label,
        fieldType: f.fieldType,
        sortOrder: f.sortOrder,
        isRequired: f.isRequired,
      });
    }
  }

  return defId;
}

export interface ArtifactSubmissionValues {
  artifactType: string;
  title?: string;
  category?: string;
  fileUrl: string;
  description?: string;
}

export async function processArtifactSubmission(submissionId: string, actorId?: string) {
  const sub = await db.select().from(formSubmissions).where(eq(formSubmissions.id, submissionId)).limit(1);
  if (sub.length === 0) throw new Error("Submission not found");

  const submission = sub[0];
  const vals = submission.values as unknown as ArtifactSubmissionValues;

  if (!vals.artifactType) throw new Error("Submission is missing artifactType");
  if (!vals.fileUrl) throw new Error("Submission is missing fileUrl");

  const artifact = await createKnowledgeArtifact({
    title: vals.title,
    artifactType: vals.artifactType,
    fileUrl: vals.fileUrl,
    description: vals.description,
    actorId,
  });

  if (vals.category) {
    await linkArtifactToCategory(artifact.id, vals.category, actorId);
  }

  await db
    .update(formSubmissions)
    .set({
      status: "approved",
      reviewedBy: actorId || null,
      reviewNotes: `Auto-processed: created knowledge artifact ${artifact.generatedId}`,
      reviewedAt: new Date(),
    })
    .where(eq(formSubmissions.id, submissionId));

  return artifact;
}
