import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { auditLog } from "@/lib/db/schema/audit_log";
import { seedOnboardingFormDefinition, ARTIST_ACCESS_FORM_KEY } from "@/lib/forms/onboarding";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const ROLE_OPTIONS = ["admin", "operator", "curator", "artist", "publisher", "uploader", "marketing", "payment_admin"] as const;

const AddPersonnelSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  roles: z.array(z.enum(ROLE_OPTIONS)).min(1),
});

export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Ensure the access-request form exists so there's always something real to point artists at.
  // The seed and the personnel list touch different tables, so they run together rather than
  // making every page load wait for the seed before the list even starts.
  const [, people, accessForm] = await Promise.all([
    seedOnboardingFormDefinition(),
    db.select().from(personnel).orderBy(desc(personnel.dateOnboarded)),
    db.select().from(formDefinitions).where(eq(formDefinitions.key, ARTIST_ACCESS_FORM_KEY)).limit(1),
  ]);

  let pendingSubmissions: (typeof formSubmissions.$inferSelect)[] = [];
  if (accessForm.length > 0) {
    pendingSubmissions = await db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.formDefinitionId, accessForm[0].id));
    pendingSubmissions = pendingSubmissions.filter((s) => s.status === "pending");
  }

  return NextResponse.json({
    personnel: people,
    pendingSubmissions,
    accessFormId: accessForm[0]?.id || null,
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = AddPersonnelSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const { name, email, roles } = parseResult.data;
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await db.select().from(personnel).where(eq(personnel.email, normalizedEmail)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: `${normalizedEmail} already exists` }, { status: 400 });
  }

  const [created] = await db
    .insert(personnel)
    .values({
      name,
      email: normalizedEmail,
      roles,
      status: "Active",
      dateOnboarded: new Date(),
    })
    .returning();

  await db.insert(auditLog).values({
    action: "addPersonnel",
    entityType: "personnel",
    entityId: created.id,
    actorId: user.personnelId || null,
    payload: { name, email: normalizedEmail, roles },
  });

  return NextResponse.json({ success: true, personnel: created });
}
