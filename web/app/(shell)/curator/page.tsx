import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { listActiveDrafts } from "@/lib/curation/draft-service";
import { getCurationFieldsView } from "@/lib/dashboard/views";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { CurationWorkspace } from "@/components/curation/CurationWorkspace";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

// The curator-facing entry point the brief's §6 describes — was referenced
// in RBAC's isRouteAllowedForRoles (pathname.startsWith("/curator")) but the
// route itself was never built, so no curator could actually reach it. Now
// lives under app/(shell) alongside admin/artist/publisher, sharing one
// sidebar — a pure curator still isn't gated by /admin's own proxy rule
// (route groups don't change the URL, still bare /curator), so this stays
// reachable for them exactly as before, just with the sidebar always
// present now instead of a page-local "Back to Admin" link.
export default async function CuratorPage() {
  const session = await getServerSession(authOptions);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !(caps.canAccessCuratorTools || caps.canManageSystemConfig)) {
    redirect("/unauthorized");
  }

  // Form fields only: budget and deadline are configured fields too, but they are backed by
  // real asset columns and the form collects them as its own typed inputs, so rendering them
  // here as well is the duplicate write path that put the same value in two places.
  // The field configuration is the same for every curator, so it is cached under the curation-fields tag and invalidated when an admin edits the field config. The drafts are this curator's own and are read fresh every time.
  const [fields, drafts] = await Promise.all([
    getCurationFieldsView(),
    session.user.personnelId ? listActiveDrafts(session.user.personnelId) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Curation"
        description="Add an item idea. Submitting it creates the SKU."
      />

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <CurationWorkspace
          fields={fields}
          initialDrafts={drafts.map((d) => ({
            id: d.id,
            ideaTitle: d.ideaTitle,
            category: d.category,
            sourceLinks: d.sourceLinks as string[],
            moodboardUrls: d.moodboardUrls as string[],
            fieldValues: d.fieldValues as Record<string, unknown>,
            version: d.version,
            updatedAt: d.updatedAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
