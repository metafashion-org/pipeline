import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getFormDefinitionByKey } from "@/lib/forms/form-service";
import { normalizeFieldOptions } from "@/lib/forms/field-options";
import { checkFormAccess, isPublicForm, normalizeAudience } from "@/lib/forms/form-access";
import { FormFiller } from "@/components/forms/FormFiller";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

// Never cached: a form's fields change whenever an admin edits them in /admin/forms, and this
// page has to show the current ones.
export const dynamic = "force-dynamic";

// The shareable link for any form built in /admin/forms: /forms/<form key>.
//
// Every form is served here, not only the public ones. A form restricted to roles or to a list of
// addresses used to 404 at this URL, which meant a restricted form had no link anyone could be
// sent — the reason "expose these forms" needed solving at all. It now renders for whoever is
// allowed and shows a sign-in prompt to everyone else, so one link works for every form.
//
// A missing form still answers with a real 404, so uptime checks see the truth rather than a 200
// carrying a 404-looking page. That depends on this route NOT sitting behind a Suspense boundary:
// a loading.tsx above it would make Next flush the shell and its 200 status before this function
// runs, and notFound() would then be too late. That is why loading.tsx lives in app/(shell)/
// rather than at the app root.

async function loadForm(formKey: string) {
  const form = await getFormDefinitionByKey(formKey);
  if (!form) return null;

  // A public form never needs the session, so the common case does not pay for one.
  if (isPublicForm(form.definition)) {
    return { form, access: { allowed: true as const } };
  }

  const session = await getServerSession(authOptions);
  const access = checkFormAccess(
    form.definition,
    session ? { email: session.user.email, roles: session.user.roles, personnelId: session.user.personnelId } : null
  );
  return { form, access, signedInAs: session?.user?.email ?? null };
}

export async function generateMetadata({ params }: { params: Promise<{ formKey: string }> }): Promise<Metadata> {
  const { formKey } = await params;
  const loaded = await loadForm(formKey);
  // Only names the page. The page body below is what calls notFound() and sets the status.
  if (!loaded || loaded.form.fields.length === 0) return { title: "Form not found" };
  return {
    title: loaded.form.definition.title,
    description: loaded.form.definition.description || undefined,
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-dvh bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 sm:px-6 py-4 border-b border-border">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold bg-primary">M</div>
        <span className="font-display font-semibold tracking-tight">MetaFashion Pipeline</span>
      </header>
      {children}
    </div>
  );
}

export default async function PublicFormPage({ params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;
  const loaded = await loadForm(formKey);
  if (!loaded) notFound();

  const { form, access } = loaded;

  // A form with no fields would render a submit button and nothing else, and record empty
  // submissions. Treat it as not ready rather than showing that.
  if (form.fields.length === 0) notFound();

  if (!access.allowed) {
    return (
      <Shell>
        <main className="flex-1 grid place-items-center p-6">
          <div className="w-full max-w-md text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full grid place-items-center bg-muted">
              <Lock className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl">{form.definition.title}</h1>
              <p className="text-sm text-muted-foreground">{access.reason}</p>
              {loaded.signedInAs && (
                <p className="text-sm text-muted-foreground">You are signed in as {loaded.signedInAs}.</p>
              )}
            </div>
            {access.status === 401 && (
              <Button asChild>
                <Link href={`/login?callbackUrl=${encodeURIComponent(`/forms/${formKey}`)}`}>Sign in</Link>
              </Button>
            )}
          </div>
        </main>
      </Shell>
    );
  }

  return (
    <Shell>
      <main className="flex-1 min-h-0">
        <FormFiller
          formKey={form.definition.key}
          title={form.definition.title}
          description={form.definition.description}
          // A restricted form already knows who is filling it, so it does not ask again.
          knownEmail={loaded.signedInAs ?? null}
          requiresContactEmail={normalizeAudience(form.definition) === "public"}
          fields={form.fields.map((f) => ({
            fieldKey: f.fieldKey,
            label: f.label,
            fieldType: f.fieldType,
            isRequired: f.isRequired,
            section: f.section,
            helpText: f.helpText,
            placeholder: f.placeholder,
            options: normalizeFieldOptions(f.options),
          }))}
        />
      </main>
    </Shell>
  );
}
