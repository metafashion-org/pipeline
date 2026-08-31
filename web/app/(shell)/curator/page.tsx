import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { getCurationFieldConfigs } from "@/lib/curation/curation-service";
import { listActiveDrafts } from "@/lib/curation/draft-service";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { CurationWorkspace } from "@/components/curation/CurationWorkspace";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";

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

  const fields = await getCurationFieldConfigs();
  const drafts = session.user.personnelId ? await listActiveDrafts(session.user.personnelId) : [];

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-lg font-semibold truncate">Curation</h1>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate">
            Add an item idea — a SKU is created the moment you submit.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ModeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <CurationWorkspace
          fields={fields.map((f) => ({ fieldKey: f.fieldKey, displayName: f.displayName, fieldType: f.fieldType, options: (f.options as string[]) || [] }))}
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
