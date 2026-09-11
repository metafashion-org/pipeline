import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getFormDefinitionByKey } from "@/lib/forms/form-service";
import { seedOnboardingFormDefinition, ARTIST_ACCESS_FORM_KEY } from "@/lib/forms/onboarding";
import { normalizeFieldOptions } from "@/lib/forms/field-options";
import { checkFormAccess, isPublicForm } from "@/lib/forms/form-access";

// Reads one form's definition and fields, so a form page renders the real, admin-configured
// fields rather than a hardcoded shape.
//
// Who may read it is decided by lib/forms/form-access.ts, which is also what the page and the
// submit route use. This route used to make the decision itself, by treating an empty
// target_roles array as "public" — the inference that let a form nobody had marked public be
// answered by anyone with the link.
export async function GET(_request: Request, { params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;

  // The Artist Access Request form is seeded lazily on first real use here, matching the pattern
  // the admin Personnel page already relies on.
  if (formKey === ARTIST_ACCESS_FORM_KEY) {
    await seedOnboardingFormDefinition();
  }

  const form = await getFormDefinitionByKey(formKey);
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  // A public form is read without touching the session at all, which keeps the common case free
  // of a session lookup it has no use for.
  if (!isPublicForm(form.definition)) {
    const session = await getServerSession(authOptions);
    const access = checkFormAccess(
      form.definition,
      session ? { email: session.user.email, roles: session.user.roles, personnelId: session.user.personnelId } : null
    );
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.status });
    }
  }

  return NextResponse.json({
    key: form.definition.key,
    title: form.definition.title,
    description: form.definition.description,
    fields: form.fields.map((f) => ({
      fieldKey: f.fieldKey,
      label: f.label,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      section: f.section,
      helpText: f.helpText,
      placeholder: f.placeholder,
      // Normalized here rather than handed over raw, so every client of this route gets one shape
      // instead of each having to cope with both.
      options: normalizeFieldOptions(f.options),
    })),
  });
}
