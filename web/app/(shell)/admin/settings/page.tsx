import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { listStatuses, listTransitionRules } from "@/lib/settings/settings-service";
import { getCurationFieldConfigs, seedDefaultCurationFieldConfig } from "@/lib/curation/curation-service";
import { SettingsManager } from "@/components/settings/SettingsManager";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.role !== "admin") {
    redirect("/unauthorized");
  }

  await seedDefaultCurationFieldConfig();
  const [statuses, rules, curationFields] = await Promise.all([
    listStatuses(),
    listTransitionRules(),
    getCurationFieldConfigs(),
  ]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold truncate">Settings</h1>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate">Configure statuses, transition rules, and assignment email fields. No code changes needed.</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ModeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <SettingsManager initialStatuses={statuses} initialRules={rules} initialCurationFields={curationFields} />
      </main>
    </div>
  );
}
