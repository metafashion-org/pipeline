import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { listFormDefinitions } from "@/lib/forms/form-engine";
import { FormBuilder } from "@/components/settings/FormBuilder";

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.role !== "admin") {
    redirect("/unauthorized");
  }

  const forms = await listFormDefinitions();

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <h1 className="text-lg font-semibold truncate">Form Builder</h1>
        <span className="hidden sm:inline text-xs text-muted-foreground truncate">Create and edit forms. Replaces Google Forms.</span>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <FormBuilder initialForms={forms} />
      </main>
    </div>
  );
}
