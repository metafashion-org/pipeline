import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { updateField, removeField, FIELD_TYPES } from "@/lib/forms/form-builder-service";
import { z } from "zod";

const UpdateFieldSchema = z.object({
  label: z.string().optional(),
  fieldType: z.enum(FIELD_TYPES).optional(),
  isRequired: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ fieldId: string }> }) {
  const [user, { fieldId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = UpdateFieldSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    return NextResponse.json({ field: await updateField(fieldId, parsed.data) });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update field" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ fieldId: string }> }) {
  const [user, { fieldId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json(await removeField(fieldId));
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to remove field" }, { status: 400 });
  }
}
