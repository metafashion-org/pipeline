import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner } from "@/lib/marketing/todays-picks-service";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { NamingBoard } from "@/components/naming/NamingBoard";

export const dynamic = "force-dynamic";

export default async function NamingPage() {
  // Naming approval is Arjun's, the same rule as its API route.
  const user = await getAuthedUser();
  if (!user?.caps.canAccessMarketingTools || !isTodaysPicksOwner(user.email)) redirect("/unauthorized");
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <PageHeader title="Naming" description="Suggested Roblox names for items waiting to upload, and your approval." />
      <PageBody>
        <NamingBoard />
      </PageBody>
    </div>
  );
}
