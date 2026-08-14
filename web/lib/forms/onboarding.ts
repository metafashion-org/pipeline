import { db } from "@/lib/db/client";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { formFields } from "@/lib/db/schema/form_fields";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";

export const ARTIST_ACCESS_FORM_KEY = "artist_access_request";

export async function seedOnboardingFormDefinition() {
  const existing = await db
    .select()
    .from(formDefinitions)
    .where(eq(formDefinitions.key, ARTIST_ACCESS_FORM_KEY))
    .limit(1);

  let defId = "";
  if (existing.length > 0) {
    defId = existing[0].id;
  } else {
    const [newDef] = await db
      .insert(formDefinitions)
      .values({
        key: ARTIST_ACCESS_FORM_KEY,
        title: "Artist Access Request",
        description: "Submit your details to request freelance artist access to Meta Fashion Digital Assets pipeline",
        targetRoles: [], // Public form
        onSubmissionBehavior: "trigger_personnel_onboarding",
        isActive: true,
      })
      .returning();
    defId = newDef.id;
  }

  // Seed default fields
  const fields = [
    { fieldKey: "fullName", label: "Full Name", fieldType: "text", sortOrder: 1, isRequired: true },
    { fieldKey: "email", label: "Email Address", fieldType: "text", sortOrder: 2, isRequired: true },
    { fieldKey: "portfolioUrl", label: "Portfolio / ArtStation Link", fieldType: "url", sortOrder: 3, isRequired: false },
    { fieldKey: "notes", label: "Skills & Background", fieldType: "textarea", sortOrder: 4, isRequired: false },
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
}

export async function approveArtistAccessSubmission(
  submissionId: string,
  reviewerId?: string,
  reviewNotes?: string
) {
  const sub = await db.select().from(formSubmissions).where(eq(formSubmissions.id, submissionId)).limit(1);
  if (sub.length === 0) throw new Error("Submission not found");

  const submission = sub[0];
  const vals = (submission.values as Record<string, any>) || {};
  const email = (submission.submitterEmail || vals["email"] || "").trim().toLowerCase();
  const name = (vals["fullName"] || "Artist").trim();

  if (!email) throw new Error("Submission has no valid email");

  // 1. Create or activate personnel record
  const existingPersonnel = await db.select().from(personnel).where(eq(personnel.email, email)).limit(1);
  let pId = "";

  if (existingPersonnel.length > 0) {
    pId = existingPersonnel[0].id;
    const currentRoles = existingPersonnel[0].roles || [];
    const newRoles = Array.from(new Set([...currentRoles, "artist"]));

    await db
      .update(personnel)
      .set({
        name,
        roles: newRoles,
        status: "Active",
        updatedAt: new Date(),
      })
      .where(eq(personnel.id, pId));
  } else {
    const [newP] = await db
      .insert(personnel)
      .values({
        name,
        email,
        roles: ["artist"],
        status: "Active",
        dateOnboarded: new Date(),
      })
      .returning();
    pId = newP.id;
  }

  // 2. Update submission record
  await db
    .update(formSubmissions)
    .set({
      status: "approved",
      reviewedBy: reviewerId || null,
      reviewNotes: reviewNotes || "Access granted by admin",
      reviewedAt: new Date(),
    })
    .where(eq(formSubmissions.id, submissionId));

  // 3. Log audit event
  await db.insert(auditLog).values({
    action: "approveArtistAccessRequest",
    entityType: "personnel",
    entityId: pId,
    actorId: reviewerId || null,
    payload: { submissionId, email, name },
  });

  return { personnelId: pId, email, status: "Active" };
}

export async function setPersonnelStatus(
  personnelId: string,
  newStatus: "Active" | "Blacklisted" | "Inactive",
  actorId?: string,
  reason?: string
) {
  const existing = await db.select().from(personnel).where(eq(personnel.id, personnelId)).limit(1);
  if (existing.length === 0) throw new Error("Personnel not found");

  const oldStatus = existing[0].status;

  await db
    .update(personnel)
    .set({
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(personnel.id, personnelId));

  await db.insert(auditLog).values({
    action: "changePersonnelStatus",
    entityType: "personnel",
    entityId: personnelId,
    actorId: actorId || null,
    payload: { oldStatus, newStatus, reason: reason || "Admin status update" },
  });

  return { personnelId, oldStatus, newStatus };
}
