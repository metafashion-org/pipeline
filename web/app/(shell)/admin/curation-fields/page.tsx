import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { getCurationFieldConfigs, seedDefaultCurationFieldConfig } from "@/lib/curation/curation-service";
import { CurationFieldSelector } from "@/components/settings/CurationFieldSelector";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

export default async function CurationFieldsPage() {
  const session = await getServerSession(authOptions);

  // canManageSystemConfig, not the deprecated collapsed session.user.role — that string is only
  // ever "admin", "operator" or "artist", so someone granted this capability by a per-person
  // override passed proxy.ts (which reads the capability) and was then bounced by this line.
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !caps.canManageSystemConfig) {
    redirect("/unauthorized");
  }

  await seedDefaultCurationFieldConfig();
  const fields = await getCurationFieldConfigs();

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Brief Fields"
        description="Which curation fields are included in the artist assignment email."
      />

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle>Brief Fields</CardTitle>
          </CardHeader>
          <CardContent>
            <CurationFieldSelector initialFields={fields} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
