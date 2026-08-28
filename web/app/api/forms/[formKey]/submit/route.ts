import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getFormDefinitionByKey, submitFormResponse } from "@/lib/forms/form-service";
import { seedOnboardingFormDefinition, ARTIST_ACCESS_FORM_KEY } from "@/lib/forms/onboarding";
import { z } from "zod";

const SubmitSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;

  if (formKey === ARTIST_ACCESS_FORM_KEY) {
    await seedOnboardingFormDefinition();
  }

  const form = await getFormDefinitionByKey(formKey);
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  let session = null;
  if (form.definition.targetRoles && form.definition.targetRoles.length > 0) {
    session = await getServerSession(authOptions);
    const roles = session?.user?.roles || [];
    if (!session || !form.definition.targetRoles.some((r) => roles.includes(r))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json();
  const parseResult = SubmitSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const submission = await submitFormResponse({
      formKey,
      values: parseResult.data.values,
      submitterId: session?.user?.personnelId,
    });
    return NextResponse.json({ success: true, submissionId: submission.id });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit form" }, { status: 400 });
  }
}
