import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { formDefinitions } from "@/lib/db/schema/form_definitions";
import { formFields } from "@/lib/db/schema/form_fields";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { formId } = await params;
  const [form] = await db.select().from(formDefinitions).where(eq(formDefinitions.id, formId)).limit(1);
  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const fields = await db
    .select()
    .from(formFields)
    .where(eq(formFields.formDefinitionId, formId))
    .orderBy(asc(formFields.sortOrder));

  return NextResponse.json({ form, fields });
}
