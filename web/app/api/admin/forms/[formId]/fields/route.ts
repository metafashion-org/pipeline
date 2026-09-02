import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { addField, reorderFields, FIELD_TYPES } from "@/lib/forms/form-builder-service";
import { z } from "zod";

const AddFieldSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.enum(FIELD_TYPES),
  isRequired: z.boolean().optional(),
  options: z.array(z.string()).optional(),
});

const ReorderSchema = z.object({ orderedFieldIds: z.array(z.string()).min(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const [user, { formId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = AddFieldSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    return NextResponse.json({ field: await addField({ formId, ...parsed.data }) });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to add field" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const [user, { formId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = ReorderSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  return NextResponse.json(await reorderFields(formId, parsed.data.orderedFieldIds));
}
