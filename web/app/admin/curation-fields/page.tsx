import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { getCurationFieldConfigs, seedDefaultCurationFieldConfig } from "@/lib/curation/curation-service";
import { CurationFieldSelector } from "@/components/settings/CurationFieldSelector";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CurationFieldsPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user?.role !== "admin") {
    redirect("/unauthorized");
  }

  await seedDefaultCurationFieldConfig();
  const fields = await getCurationFieldConfigs();

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold truncate">Brief Fields</h1>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate">Choose which curation fields get included in the artist assignment email</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ModeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <Card className="shadow-sm hover:shadow-md transition-all">
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
