import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { createForm, SUBMISSION_BEHAVIORS, FORM_AUDIENCES } from "@/lib/forms/form-builder-service";
import { getFormsView } from "@/lib/dashboard/views";
import { z } from "zod";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

const CreateFormSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  audience: z.enum(FORM_AUDIENCES).optional(),
  targetRoles: z.array(z.string()).optional(),
  allowedEmails: z.array(z.email()).optional(),
  onSubmissionBehavior: z.enum(SUBMISSION_BEHAVIORS).optional(),
});

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ forms: await getFormsView() });
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = CreateFormSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    // The author comes from the session, never the request body.
    const form = await createForm({ ...parsed.data, createdBy: user.personnelId });
    revalidateViews(CACHE_TAGS.forms);
    return NextResponse.json({ form });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create form" }, { status: 400 });
  }
}
