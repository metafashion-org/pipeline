import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { canAddAssets, getEffectiveCapabilities } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/layout/PageHeader";
import { SignoffQueue } from "@/components/signoff/SignoffQueue";

export const dynamic = "force-dynamic";

// Sign-off: assets the team added, waiting for Arjun before they go on the board. Replaces the
// retired Curation form. Open to anyone who can add assets, so they can see where theirs stand and
// fix what was sent back; only an admin approves, sends back or drops.
export default async function SignoffPage() {
  const session = await getServerSession(authOptions);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !canAddAssets(caps)) redirect("/unauthorized");

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader title="Sign-off" description="New assets wait here for Arjun before they go on the board." />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <SignoffQueue />
      </main>
    </div>
  );
}
