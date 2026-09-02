import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getFormDefinitionByKey } from "@/lib/forms/form-service";
import { PublicForm } from "@/components/forms/PublicForm";

// Never cached: a form's fields change whenever an admin edits them in /admin/forms, and the
// public page has to show the current ones.
export const dynamic = "force-dynamic";

// The shareable public link for any form built in /admin/forms.
//
// Before this there was exactly one public form page, /apply, hardcoded to the artist-access
// form's key. Anything created in the builder had no URL a person could open — the form existed,
// accepted submissions over its API, and was reachable by nobody. This is that missing half:
// /forms/<form key> renders any active form.
//
// Only genuinely public forms are served here. A form with targetRoles set is not "a public page
// that checks permissions", it is not public at all, so this 404s rather than prompting for a
// login — the existence of an internal form is not something to advertise on an open URL. Those
// are reached from inside the app, where the API route enforces the same rule.
//
// A missing form answers with a real 404, so uptime checks see the truth rather than a 200
// carrying a 404-looking page. That depends on this route NOT sitting behind a Suspense
// boundary: a loading.tsx above it would make Next flush the shell and its 200 status before
// this function runs, and notFound() would then be too late to change it. That is why
// loading.tsx lives in app/(shell)/ rather than at the app root — see the comment there.

async function loadPublicForm(formKey: string) {
  const form = await getFormDefinitionByKey(formKey);
  if (!form) return null;
  const isPublic = !form.definition.targetRoles || form.definition.targetRoles.length === 0;
  return isPublic ? form : null;
}

export async function generateMetadata({ params }: { params: Promise<{ formKey: string }> }): Promise<Metadata> {
  const { formKey } = await params;
  const form = await loadPublicForm(formKey);
  // Only names the page. The page body below is what calls notFound() and sets the status.
  if (!form || form.fields.length === 0) return { title: "Form not found" };
  return {
    title: form.definition.title,
    description: form.definition.description || undefined,
  };
}

export default async function PublicFormPage({ params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;
  const form = await loadPublicForm(formKey);
  if (!form) notFound();

  // A form with no fields would render a Submit button and nothing else, and record empty
  // submissions. Treat it as not ready rather than showing that.
  if (form.fields.length === 0) notFound();

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 sm:px-6 py-4 border-b border-border">
        <div className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold text-sm bg-primary">M</div>
        <span className="font-display font-semibold tracking-tight">MetaFashion Pipeline</span>
      </header>
      <main className="flex-1 flex items-start justify-center p-4 sm:p-8">
        <div className="w-full max-w-2xl">
          <h1 className="text-xl font-display font-semibold">{form.definition.title}</h1>
          {form.definition.description && (
            <p className="text-sm text-muted-foreground mt-1 mb-6">{form.definition.description}</p>
          )}
          <PublicForm
            formKey={form.definition.key}
            fields={form.fields.map((f) => ({
              fieldKey: f.fieldKey,
              label: f.label,
              fieldType: f.fieldType,
              isRequired: f.isRequired,
              options: (f.options as string[]) || [],
            }))}
          />
        </div>
      </main>
    </div>
  );
}
