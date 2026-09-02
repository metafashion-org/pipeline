import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { listStatuses, upsertStatus } from "@/lib/settings/settings-service";
import { z } from "zod";

const UpsertStatusSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  sortOrder: z.number(),
  description: z.string().optional(),
  whoCanMoveIn: z.array(z.string()).optional(),
  nextActionHint: z.string().optional(),
  automationNote: z.string().optional(),
});

export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await listStatuses();
  return NextResponse.json({ statuses: rows });
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
  const parseResult = UpsertStatusSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const row = await upsertStatus(parseResult.data);
    return NextResponse.json({ success: true, status: row });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save status" },
      { status: 400 }
    );
  }
}
