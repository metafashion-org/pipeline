import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getFormDefinitionByKey, submitFormResponse } from "@/lib/forms/form-service";
import { seedOnboardingFormDefinition, ARTIST_ACCESS_FORM_KEY } from "@/lib/forms/onboarding";
import { checkSubmissionRate, clientKeyFor } from "@/lib/forms/rate-limit";
import { z } from "zod";

const SubmitSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  // Public forms that don't declare their own "email" field send the submitter's address here,
  // so every public submission has a way to reach the person who made it.
  submitterEmail: z.string().optional(),
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

  // Rate limit before doing any work. A public form has no session to hold anyone to, so this
  // is the only thing standing between the submissions table and whoever finds the URL.
  const rate = checkSubmissionRate(clientKeyFor(request));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many submissions. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
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
      submitterEmail: parseResult.data.submitterEmail,
      submitterId: session?.user?.personnelId,
    });
    // The submission itself succeeded even if its follow-on behavior did not; say so rather
    // than reporting a clean success or losing the distinction.
    return NextResponse.json({
      success: true,
      submissionId: submission.id,
      ...(submission.behaviorError ? { warning: submission.behaviorError } : {}),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit form" }, { status: 400 });
  }
}
