import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { seedOnboardingFormDefinition } from "@/lib/forms/onboarding";
import { syncOnboardingRequests, listOnboardingRequests } from "@/lib/personnel/onboarding-sync";
import { PersonnelManager } from "@/components/settings/PersonnelManager";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { desc } from "drizzle-orm";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

export default async function PersonnelPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.role !== "admin") {
    redirect("/unauthorized");
  }

  // The form seed has to be in place before the sync reads its submissions, and the personnel list does not depend on either, so it runs alongside them.
  const [people] = await Promise.all([
    db.select().from(personnel).orderBy(desc(personnel.dateOnboarded)),
    seedOnboardingFormDefinition(),
  ]);

  // Opening the page brings in whatever has arrived by form or turned up in Discord since the last look. The Discord read behind it is cached for a minute (lib/discord/discord-cache.ts), so reloading this page repeatedly does not mean repeatedly fetching the whole guild. The sync only ever writes pending rows; nobody is granted anything by loading this page.
  const syncResult = await syncOnboardingRequests();
  const requests = await listOnboardingRequests();

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Personnel"
        description="Review access requests, manage roles, grant or revoke access."
        actions={<Button variant="outline" size="sm" asChild><Link href="/admin/personnel/discord">Discord</Link></Button>}
      />

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
          initialRequests={requests}
          initialSyncWarning={syncResult.warning ?? null}
        />
      </main>
    </div>
  );
}
