import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { PageHeader } from "@/components/layout/PageHeader";
import { MyDetailsForm } from "@/components/artist-details/MyDetailsForm";

export const dynamic = "force-dynamic";

// My details: an artist's payment and identity details, replacing the Team Onboarding Google Form.
// proxy.ts already limits /artist to artists and the people who assign them.
export default async function MyDetailsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.personnelId) redirect("/unauthorized");

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader title="My details" description="How we pay you. Fill it in once; after that, a change needs a reason and our approval." />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <MyDetailsForm />
      </main>
    </div>
  );
}
