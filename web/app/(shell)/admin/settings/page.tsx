import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { listStatuses, listTransitionRules } from "@/lib/settings/settings-service";
import { getCurationFieldConfigs, seedDefaultCurationFieldConfig } from "@/lib/curation/curation-service";
import { SettingsManager } from "@/components/settings/SettingsManager";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  // canManageSystemConfig, not the deprecated collapsed session.user.role — that string is only
  // ever "admin", "operator" or "artist", so someone granted this capability by a per-person
  // override passed proxy.ts (which reads the capability) and was then bounced by this line.
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !caps.canManageSystemConfig) {
    redirect("/unauthorized");
  }

  await seedDefaultCurationFieldConfig();
  const [statuses, rules, curationFields] = await Promise.all([
    listStatuses(),
    listTransitionRules(),
    getCurationFieldConfigs(),
  ]);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Settings"
        description="Statuses, transition rules, and which fields go in the assignment email."
      />

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <SettingsManager initialStatuses={statuses} initialRules={rules} initialCurationFields={curationFields} />
      </main>
    </div>
  );
}
