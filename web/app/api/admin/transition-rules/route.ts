import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { listTransitionRules, upsertTransitionRule } from "@/lib/settings/settings-service";
import { z } from "zod";

const UpsertRuleSchema = z.object({
  fromStatus: z.string().min(1),
  toStatus: z.string().min(1),
  role: z.string().nullable().optional(),
  isAutomatic: z.boolean().optional(),
  triggerNote: z.string().optional(),
});

export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await listTransitionRules();
  return NextResponse.json({ rules: rows });
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
  const parseResult = UpsertRuleSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const row = await upsertTransitionRule(parseResult.data);
    return NextResponse.json({ success: true, rule: row });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save transition rule" },
      { status: 400 }
    );
  }
}
