import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/discord/discord-service";
import { getDiscordOverview, getDepartments, listTempAccessGrants } from "@/lib/discord/team-service";
import { isDiscordManagerTier, isDiscordAdminTier } from "@/lib/auth/rbac";
import { DiscordTeamManager } from "@/components/discord/DiscordTeamManager";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

// Phase 2 of the Discord/personnel migration: real write actions
// (onboarding, channel permissions, archive/restore/delete, kicks, temp
// access) on top of phase 1's read-only Team Overview. Ported faithfully
// from Catalog Intel's own proven server/server.cjs routes — see
// lib/discord/team-service.ts for the full port notes and HANDOFF.md for
// the phase checklist. Two-tier access (Manager/Admin) maps onto this
// app's real admin/operator roles instead of a separate Discord-specific
// role field — see isDiscordManagerTier/isDiscordAdminTier in rbac.ts.
export default async function DiscordTeamManagerPage() {
  const session = await getServerSession(authOptions);
  const roles = session?.user?.roles || [];
  if (!session || !isDiscordManagerTier(roles)) {
    redirect("/unauthorized");
  }

  const configured = isConfigured();
  let overview: Awaited<ReturnType<typeof getDiscordOverview>> = { members: [], channels: [], archived: [], categories: [] };
  let fetchError: string | null = null;
  let tempGrants: Awaited<ReturnType<typeof listTempAccessGrants>> = [];

  if (configured) {
    try {
      [overview, tempGrants] = await Promise.all([getDiscordOverview(), listTempAccessGrants()]);
    } catch (e) {
      fetchError = e instanceof Error ? e.message : "Failed to reach Discord.";
    }
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Discord Team Manager"
        description="Actions here run against the Meta Fashion 3D Team Discord server."
        actions={<Button variant="outline" size="sm" asChild><Link href="/admin/personnel">Back to Personnel</Link></Button>}
      />

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        {!configured && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground max-w-lg">
            Discord isn&apos;t configured on this deployment (<code className="text-xs bg-muted px-1 py-0.5 rounded">DISCORD_BOT_TOKEN</code> /
            <code className="text-xs bg-muted px-1 py-0.5 rounded ml-1">DISCORD_GUILD_ID</code> not set).
          </div>
        )}

        {fetchError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive max-w-lg">
            Couldn&apos;t reach Discord: {fetchError}
          </div>
        )}

        {configured && !fetchError && (
          <DiscordTeamManager
            initialOverview={overview}
            departments={getDepartments()}
            initialTempGrants={tempGrants}
            isManagerTier={isDiscordManagerTier(roles)}
            isAdminTier={isDiscordAdminTier(roles)}
          />
        )}
      </main>
    </div>
  );
}
