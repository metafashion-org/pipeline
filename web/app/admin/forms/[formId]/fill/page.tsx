import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { formFields } from "@/lib/db/schema/form_fields";
import { eq, asc } from "drizzle-orm";
import { FormFill } from "@/components/settings/FormFill";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function FormFillPage({ params }: { params: Promise<{ formId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/unauthorized");
  }

  const { formId } = await params;
  const [form] = await db.select().from(formDefinitions).where(eq(formDefinitions.id, formId)).limit(1);
  if (!form) {
    notFound();
  }

  const fields = await db
    .select()
    .from(formFields)
    .where(eq(formFields.formDefinitionId, formId))
    .orderBy(asc(formFields.sortOrder));

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/forms">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold truncate">Fill: {form.title}</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <FormFill
          formId={form.id}
          title={form.title}
          description={form.description}
          fields={fields.map((f) => ({
            id: f.id,
            fieldKey: f.fieldKey,
            label: f.label,
            fieldType: f.fieldType,
            isRequired: f.isRequired,
            options: (f.options as { label: string; value: string }[]) || [],
          }))}
        />
      </main>
    </div>
  );
}
