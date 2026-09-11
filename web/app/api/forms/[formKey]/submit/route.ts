import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getFormDefinitionByKey, submitFormResponse } from "@/lib/forms/form-service";
import { seedOnboardingFormDefinition, ARTIST_ACCESS_FORM_KEY } from "@/lib/forms/onboarding";
import { checkSubmissionRate, clientKeyFor } from "@/lib/forms/rate-limit";
import { checkFormAccess, isPublicForm } from "@/lib/forms/form-access";
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

  // Same rule the page and the read route use — see lib/forms/form-access.ts. The session is read
  // for a restricted form even when the answer turns out to be no, because a signed-in submitter
  // is also how the submission gets attributed to a person rather than to an address they typed.
  let session = null;
  if (!isPublicForm(form.definition)) {
    session = await getServerSession(authOptions);
    const access = checkFormAccess(
      form.definition,
      session ? { email: session.user.email, roles: session.user.roles, personnelId: session.user.personnelId } : null
    );
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.status });
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
      // The address on the session wins over anything in the body: on a restricted form it is the
      // address access was granted against, so recording a different one would leave a submission
      // attributed to someone who did not make it.
      submitterEmail: session?.user?.email || parseResult.data.submitterEmail,
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
