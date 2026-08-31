import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getFormDefinitionByKey } from "@/lib/forms/form-service";
import { seedOnboardingFormDefinition, ARTIST_ACCESS_FORM_KEY } from "@/lib/forms/onboarding";

// Public read of a form's own definition + fields, so a public form page
// can render real, admin-configured fields instead of a hardcoded shape -
// same "dynamic form fields" principle the curation form already uses.
// targetRoles === [] means public (per form_definitions' own column
// comment); anything else requires a session carrying one of those roles.
export async function GET(_request: Request, { params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;

  // The Artist Access Request form is seeded lazily on first real use here,
  // matching the same pattern the admin Personnel page already relies on.
  if (formKey === ARTIST_ACCESS_FORM_KEY) {
    await seedOnboardingFormDefinition();
  }

  const form = await getFormDefinitionByKey(formKey);
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  if (form.definition.targetRoles && form.definition.targetRoles.length > 0) {
    const session = await getServerSession(authOptions);
    const roles = session?.user?.roles || [];
    if (!session || !form.definition.targetRoles.some((r) => roles.includes(r))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      options: f.options,
    })),
  });
}
