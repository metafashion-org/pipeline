import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { listForms, createForm, SUBMISSION_BEHAVIORS } from "@/lib/forms/form-builder-service";
import { z } from "zod";

const CreateFormSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  targetRoles: z.array(z.string()).optional(),
  onSubmissionBehavior: z.enum(SUBMISSION_BEHAVIORS).optional(),
});

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({ forms: await listForms() });
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = CreateFormSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    return NextResponse.json({ form: await createForm(parsed.data) });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create form" }, { status: 400 });
  }
}
