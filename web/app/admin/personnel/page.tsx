import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { seedOnboardingFormDefinition, ARTIST_ACCESS_FORM_KEY } from "@/lib/forms/onboarding";
import { PersonnelManager } from "@/components/settings/PersonnelManager";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function PersonnelPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.role !== "admin") {
    redirect("/unauthorized");
  }

  // The seed, the personnel list and the access-form lookup are independent, so they run together instead of costing three round trips in a row.
  const [, people, accessForm] = await Promise.all([
    seedOnboardingFormDefinition(),
    db.select().from(personnel).orderBy(desc(personnel.dateOnboarded)),
    db
      .select()
      .from(formDefinitions)
      .where(eq(formDefinitions.key, ARTIST_ACCESS_FORM_KEY))
      .limit(1),
  ]);

  let pendingSubmissions: (typeof formSubmissions.$inferSelect)[] = [];
  if (accessForm.length > 0) {
    const rows = await db
      .select()
      .from(formSubmissions)
      .where(eq(formSubmissions.formDefinitionId, accessForm[0].id));
    pendingSubmissions = rows.filter((s) => s.status === "pending");
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold truncate">Personnel</h1>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate">Review access requests, manage roles, grant or revoke access.</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ModeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <PersonnelManager
          currentPersonnelId={session.user.personnelId}
          initialPersonnel={people.map((p) => ({
            id: p.id,
            name: p.name,
            email: p.email,
            roles: p.roles,
            status: p.status,
            dateOnboarded: p.dateOnboarded ? p.dateOnboarded.toISOString() : null,
          }))}
          initialPendingSubmissions={pendingSubmissions.map((s) => ({
            id: s.id,
            submitterEmail: s.submitterEmail,
            values: s.values as Record<string, unknown>,
            createdAt: s.createdAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
