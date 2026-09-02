import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { seedOnboardingFormDefinition } from "@/lib/forms/onboarding";
import { seedArtifactSubmissionFormDefinition } from "@/lib/knowledge/artifact-submission";
import { FormBuilder } from "@/components/forms/FormBuilder";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { ArrowLeft } from "lucide-react";

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
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin" aria-label="Back to admin">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold truncate">Forms</h1>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate">
            Build a form, choose who can fill it, and see what came in.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ModeToggle />
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <FormBuilder />
      </main>
    </div>
  );
}
