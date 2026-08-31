import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { getReadyForUploadQueue } from "@/lib/publisher/publisher-service";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { PublisherQueue } from "@/components/publisher/PublisherQueue";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

// The Uploader-facing entry point the brief's §9 describes — referenced in
// RBAC's isRouteAllowedForRoles (pathname.startsWith("/publisher")) but the
// route itself was never built, the same gap /curator had. Shows the shared
// Ready for Upload queue (see notifyUploader's design note in
// deliverables-service.ts for why it's a shared queue, not per-person
// assignment) with a Roblox-link submission form per item. Lives under
// app/(shell) alongside admin/artist/curator now — see the matching
// comment in app/(shell)/curator/page.tsx for why that's safe for a pure
// publisher/uploader account too.
export default async function PublisherPage() {
  const session = await getServerSession(authOptions);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !caps.canPublishToRoblox) {
    redirect("/unauthorized");
  }

  const queue = await getReadyForUploadQueue();

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-lg font-semibold truncate">Uploader queue</h1>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate">
            Assets Ready for Upload — record the Roblox link to publish.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ModeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <PublisherQueue
          initialItems={queue.map((item) => ({
            ...item,
            deadline: item.deadline ? item.deadline.toISOString() : null,
            updatedAt: item.updatedAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
