import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { getKnowledgeArtifacts, listArtifactTypes } from "@/lib/knowledge/artifacts-service";
import { KnowledgeRegistry } from "@/components/knowledge/KnowledgeRegistry";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

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
  const roles = session?.user?.roles || [];
  if (!session || !(roles.includes("admin") || roles.includes("operator"))) {
    redirect("/unauthorized");
  }

  const [artifacts, types] = await Promise.all([getKnowledgeArtifacts(), listArtifactTypes()]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold truncate">Knowledge Registry</h1>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate">
            Trend briefs, insights, recolor kits, references — every artifact with a real, permanent ID.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ModeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <KnowledgeRegistry
          initialArtifacts={artifacts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))}
          artifactTypes={types.map((t) => ({ id: t.id, prefix: t.prefix, label: t.label }))}
        />
      </main>
    </div>
  );
}
