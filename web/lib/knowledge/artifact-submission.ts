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
        description: "Submit a reusable trend brief, insight, recolor kit, reference, or any configured artifact type to the Knowledge Registry",
        targetRoles: ["admin", "operator", "curator"],
        onSubmissionBehavior: "trigger_artifact_creation",
        isActive: true,
      })
      .returning();
    defId = newDef.id;
  }

  const fields = [
    { fieldKey: "artifactTypeId", label: "Artifact Type", fieldType: "select" as const, sortOrder: 1, isRequired: true },
    { fieldKey: "title", label: "Title", fieldType: "text" as const, sortOrder: 2, isRequired: true },
    { fieldKey: "description", label: "Description", fieldType: "textarea" as const, sortOrder: 3, isRequired: false },
    { fieldKey: "source", label: "Source", fieldType: "text" as const, sortOrder: 4, isRequired: false },
    { fieldKey: "fileUrl", label: "File / Link", fieldType: "url" as const, sortOrder: 5, isRequired: false },
    { fieldKey: "tags", label: "Tags", fieldType: "multi_select" as const, sortOrder: 6, isRequired: false },
    { fieldKey: "category", label: "Theme / Trend / Category (links this artifact to it)", fieldType: "text" as const, sortOrder: 7, isRequired: false },
    { fieldKey: "usageNotes", label: "Usage Notes", fieldType: "textarea" as const, sortOrder: 8, isRequired: false },
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
  artifactTypeId: string;
  title: string;
  description?: string;
  source?: string;
  fileUrl?: string;
  tags?: string[];
  category?: string;
  usageNotes?: string;
}

export async function processArtifactSubmission(submissionId: string, actorId?: string) {
  const sub = await db.select().from(formSubmissions).where(eq(formSubmissions.id, submissionId)).limit(1);
  if (sub.length === 0) throw new Error("Submission not found");

  const submission = sub[0];
  const vals = submission.values as unknown as ArtifactSubmissionValues;

  if (!vals.artifactTypeId) throw new Error("Submission is missing artifactTypeId");
  if (!vals.title) throw new Error("Submission is missing title");

  const artifact = await createKnowledgeArtifact({
    artifactTypeId: vals.artifactTypeId,
    title: vals.title,
    description: vals.description,
    source: vals.source,
    fileUrl: vals.fileUrl,
    tags: vals.tags,
    usageNotes: vals.usageNotes,
    addedBy: submission.submitterId || undefined,
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
      reviewNotes: `Auto-processed: created knowledge artifact ${artifact.artifactId}`,
      reviewedAt: new Date(),
    })
    .where(eq(formSubmissions.id, submissionId));

  return artifact;
}
