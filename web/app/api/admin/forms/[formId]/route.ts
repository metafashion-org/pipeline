import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getFormById, updateForm, deactivateForm, listSubmissions, SUBMISSION_BEHAVIORS } from "@/lib/forms/form-builder-service";
import { z } from "zod";

const UpdateFormSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  targetRoles: z.array(z.string()).optional(),
  onSubmissionBehavior: z.enum(SUBMISSION_BEHAVIORS).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const [user, { formId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await getFormById(formId);
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });

  return NextResponse.json({ ...form, submissions: await listSubmissions(formId) });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const [user, { formId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = UpdateFormSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    return NextResponse.json({ form: await updateForm(formId, parsed.data) });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update form" }, { status: 400 });
  }
}

// Deactivates rather than deletes: form_submissions cascades on delete, so removing a form here
// would take every response already given with it.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const [user, { formId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json({ form: await deactivateForm(formId) });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to deactivate form" }, { status: 400 });
  }
}
