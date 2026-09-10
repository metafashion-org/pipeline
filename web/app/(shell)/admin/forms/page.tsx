import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { seedOnboardingFormDefinition } from "@/lib/forms/onboarding";
import { seedArtifactSubmissionFormDefinition } from "@/lib/knowledge/artifact-submission";
import { FormBuilder } from "@/components/forms/FormBuilder";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

// The forms engine's missing half. form_definitions/form_fields were always meant to be edited
// rather than seeded — "add, rename, or retire fields at any time without breaking existing
// records" — but every form had to be written as a code seeder and deployed. This is the page
// that makes the table live up to that.
export default async function AdminFormsPage() {
  const user = await getAuthedUser();
  if (!user?.caps.canManageSystemConfig) {
    redirect("/unauthorized");
  }

  // The two code-seeded forms are created on first visit so they show up here alongside
  // anything made by hand, rather than appearing only after someone happens to open /apply.
  await Promise.all([seedOnboardingFormDefinition(), seedArtifactSubmissionFormDefinition()]);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Forms"
        description="Build a form, choose who can fill it, and read what came in."
      />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <FormBuilder />
      </main>
    </div>
  );
}
