import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getCurationFieldConfigs, updateCurationFieldConfig } from "@/lib/curation/curation-service";
import { z } from "zod";

const UpdateCurationFieldSchema = z.object({
  fieldKey: z.string().min(1),
  includeInArtistEmail: z.boolean(),
});

// Read-only: anyone who can assign artists needs to see this list too (the
// assignment dialog previews which fields go in the brief) — was admin-only,
// which would have silently 401'd that preview for operators, who can
// assign artists per RBAC but aren't admins. Changing the config (POST,
// below) stays admin-only.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists && !user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await getCurationFieldConfigs();
  return NextResponse.json({ fields: rows });
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = UpdateCurationFieldSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const row = await updateCurationFieldConfig(parseResult.data.fieldKey, {
      includeInArtistEmail: parseResult.data.includeInArtistEmail,
    });
    return NextResponse.json({ success: true, field: row });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update field" },
      { status: 400 }
    );
  }
}
