import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canPutOnSale } from "@/lib/publisher/on-sale-service";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { TodaysPicksPreview } from "@/components/marketing/TodaysPicksPreview";

export const dynamic = "force-dynamic";

export default async function TodaysPicksPage() {
  // Arjun's own nomination workflow: admins only, the same rule as its API routes.
  const user = await getAuthedUser();
  if (!user?.caps.canAccessMarketingTools || !canPutOnSale(user.roles)) redirect("/unauthorized");

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <PageHeader title="Today's Picks" description="Live SKUs, their Roblox listings, and what still blocks a nomination draft." />
      <PageBody>
        <TodaysPicksPreview />
      </PageBody>
    </div>
  );
}
