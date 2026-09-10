import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { getPublisherQueueView } from "@/lib/dashboard/views";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { PublisherQueue } from "@/components/publisher/PublisherQueue";

import { PageHeader } from "@/components/layout/PageHeader";

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

  // Cached under the publisher-queue tag and invalidated when an asset enters or leaves the queue, so coming back to this view does not re-run the query.
  const queue = await getPublisherQueueView();

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Uploader Queue"
        description="Assets ready for upload. Record the Roblox link to publish."
      />

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <PublisherQueue initialItems={queue} />
      </main>
    </div>
  );
}
