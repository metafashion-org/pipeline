import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { addFormField, reorderFormFields } from "@/lib/forms/form-engine";
import { z } from "zod";

const AddFieldSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.enum(["text", "textarea", "select", "multi_select", "url", "image", "file"]),
  isRequired: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
});

const ReorderSchema = z.object({
  orderedFieldIds: z.array(z.string()),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  const [session, { formId }] = await Promise.all([getServerSession(authOptions), params]);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parseResult = AddFieldSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const field = await addFormField({ ...parseResult.data, formDefinitionId: formId });
    return NextResponse.json({ success: true, field });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add field" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  const [session, { formId }] = await Promise.all([getServerSession(authOptions), params]);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parseResult = ReorderSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  await reorderFormFields(formId, parseResult.data.orderedFieldIds);
  return NextResponse.json({ success: true });
}
