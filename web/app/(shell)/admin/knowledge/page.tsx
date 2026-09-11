import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { canManageKnowledge, getEffectiveCapabilities } from "@/lib/auth/rbac";
import { getKnowledgeRegistryView } from "@/lib/dashboard/views";
import { KnowledgeRegistry } from "@/components/knowledge/KnowledgeRegistry";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

// The Knowledge Registry, per the brief's §7 — every submitted artifact
// lands here with its real, permanent typed ID (TR001, RK001, etc.).
export default async function KnowledgePage() {
  const session = await getServerSession(authOptions);
  // Was admin-only, which is stricter than it needs to be given this page
  // lives under /admin (proxy.ts already only lets admin/operator this
  // far) - operators manage production day to day and are exactly who'd
  // be linking artifacts to SKUs/briefs, so this widens to match every
  // other /admin page's real access boundary instead of an arbitrarily
  // tighter one. A pure curator still can't reach this page at all (the
  // /admin proxy gate bounces them before this check even runs) - giving
  // curators their own path to Knowledge is a bigger, separate change.
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !canManageKnowledge(caps)) {
    redirect("/unauthorized");
  }

  // Cached under the knowledge tag; the artifact and link routes invalidate it on every write.
  const { artifacts, types } = await getKnowledgeRegistryView();

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Knowledge Registry"
        description="Trend briefs, insights, recolor kits and references, each with a permanent ID."
      />

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <KnowledgeRegistry initialArtifacts={artifacts} artifactTypes={types} />
      </main>
    </div>
  );
}
