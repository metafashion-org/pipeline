import { seedOnboardingFormDefinition, ARTIST_ACCESS_FORM_KEY } from "@/lib/forms/onboarding";
import { getFormDefinitionByKey } from "@/lib/forms/form-service";
import { PublicForm } from "@/components/forms/PublicForm";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// The Artist Access Request form's submission side — the approval side
// (app/admin/personnel/page.tsx, approveArtistAccessSubmission in
// lib/forms/onboarding.ts) already existed and expected real submissions
// to review, but there was no page or route anywhere a prospective artist
// could actually submit one. Deliberately public (no login) - this is how
// someone with no account yet requests one. Flow-state layout: every field
// visible in a grid, fillable in any order, same principle the curation
// form (brief §6) already uses.
export default async function ApplyPage() {
  await seedOnboardingFormDefinition();
  const form = await getFormDefinitionByKey(ARTIST_ACCESS_FORM_KEY);
  if (!form) notFound();

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 sm:px-6 py-4 border-b border-border">
        <div className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold text-sm bg-primary">M</div>
        <span className="font-display font-semibold tracking-tight">MetaFashion Pipeline</span>
      </header>
      <main className="flex-1 flex items-start justify-center p-4 sm:p-8">
        <div className="w-full max-w-2xl">
          <h1 className="text-xl font-display font-semibold">{form.definition.title}</h1>
          {form.definition.description && <p className="text-sm text-muted-foreground mt-1 mb-6">{form.definition.description}</p>}
          <PublicForm
            formKey={ARTIST_ACCESS_FORM_KEY}
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
