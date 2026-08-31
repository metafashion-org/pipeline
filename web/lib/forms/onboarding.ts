import { db } from "@/lib/db/client";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { formFields } from "@/lib/db/schema/form_fields";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";
import { invalidatePersonnelAuthCache } from "@/lib/auth/personnel-auth";
import { isConfigured as isDiscordConfigured, archiveChannel, restoreChannel } from "@/lib/discord/team-service";

export const ARTIST_ACCESS_FORM_KEY = "artist_access_request";

// The seed is idempotent but not free: it runs five sequential round trips to confirm rows that, after the first run, always already exist.
// Page renders and API handlers call it defensively on every request, which cost roughly 1.6 seconds per /admin/personnel load against a remote database.
// Holding the in-flight promise collapses that to once per server process, and concurrent callers await the same run rather than racing five duplicate ones.
let onboardingSeedPromise: Promise<void> | null = null;

export function seedOnboardingFormDefinition(): Promise<void> {
  if (!onboardingSeedPromise) {
    // A failed seed must not be cached, or every later request inherits the failure without retrying.
    onboardingSeedPromise = runOnboardingSeed().catch((error) => {
      onboardingSeedPromise = null;
      throw error;
    });
  }
  return onboardingSeedPromise;
}

async function runOnboardingSeed() {
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

  // Each field is keyed independently, so the check-and-insert pairs do not interact and run concurrently.
  await Promise.all(
    fields.map(async (f) => {
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
    })
  );
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

  invalidatePersonnelAuthCache(email);

  return { personnelId: pId, email, status: "Active" };
}

const DEACTIVATED_STATUSES = new Set(["Inactive", "Blacklisted"]);

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

  // Auth lookups are cached briefly for performance, so a revoked login would otherwise keep working until that window lapsed.
  // Dropping the entry here makes revoking access take effect on the very next request in this process.
  invalidatePersonnelAuthCache(existing[0].email);

  const discordSyncWarning = await syncDiscordChannelForStatusChange(existing[0], oldStatus, newStatus);

  return { personnelId, oldStatus, newStatus, discordSyncWarning };
}

// Keeps a person's Discord channel out of Jayesh's (or any manager's)
// active-coordination view once they're no longer Active — archived
// (moved to "📦 Archive", read-only, still visible for record-keeping —
// nothing is ever deleted) on the way to Inactive/Blacklisted, restored
// to wherever it came from on the way back to Active. Only acts when this
// person actually has a linked Discord channel; most personnel records
// predate the Discord link and simply have nothing to do here. Never
// throws — a Discord hiccup (bot down, channel deleted by hand, etc.)
// must not block the actual status change, which is the real action the
// admin asked for. Returns a warning string for the caller to surface if
// the Discord side didn't go through, or undefined if there was nothing
// to do or it succeeded.
async function syncDiscordChannelForStatusChange(
  personnelRow: typeof personnel.$inferSelect,
  oldStatus: string,
  newStatus: string
): Promise<string | undefined> {
  const channelId = personnelRow.discordChannelId;
  if (!channelId || !isDiscordConfigured()) return undefined;

  const wasActive = oldStatus === "Active";
  const wasDeactivated = DEACTIVATED_STATUSES.has(oldStatus);
  const isNowActive = newStatus === "Active";
  const isNowDeactivated = DEACTIVATED_STATUSES.has(newStatus);

  try {
    if (wasActive && isNowDeactivated) {
      const { priorCategoryId } = await archiveChannel(channelId);
      if (priorCategoryId) {
        await db.update(personnel).set({ discordPriorCategoryId: priorCategoryId }).where(eq(personnel.id, personnelRow.id));
      }
    } else if (wasDeactivated && isNowActive) {
      if (personnelRow.discordPriorCategoryId) {
        await restoreChannel(channelId, personnelRow.discordPriorCategoryId);
        await db.update(personnel).set({ discordPriorCategoryId: null }).where(eq(personnel.id, personnelRow.id));
      }
    }
    return undefined;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[discord] Failed to sync channel for personnel status change:", msg);
    return `Status updated, but syncing their Discord channel failed: ${msg}`;
  }
}
