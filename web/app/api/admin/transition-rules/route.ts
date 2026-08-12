import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
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
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await listTransitionRules();
  return NextResponse.json({ rules: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
