import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { addField, reorderFields, FIELD_TYPES } from "@/lib/forms/form-builder-service";
import { z } from "zod";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

const AddFieldSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.enum(FIELD_TYPES),
  isRequired: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  section: z.string().nullable().optional(),
  helpText: z.string().nullable().optional(),
  placeholder: z.string().nullable().optional(),
});

// Accepts either bare ids or {id, section} entries, so one call can reorder within a section and
// move a field between sections — which in the builder is the same drag.
const ReorderSchema = z.object({
  orderedFieldIds: z
    .array(z.union([z.string(), z.object({ id: z.string(), section: z.string().nullable().optional() })]))
    .min(1),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const [user, { formId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = AddFieldSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    const field = await addField({ formId, ...parsed.data });
    revalidateViews(CACHE_TAGS.forms);
    return NextResponse.json({ field });
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

  const result = await reorderFields(formId, parsed.data.orderedFieldIds);
  revalidateViews(CACHE_TAGS.forms);
  return NextResponse.json(result);
}
