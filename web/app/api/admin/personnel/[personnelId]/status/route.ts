import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { setPersonnelStatus } from "@/lib/forms/onboarding";
import { isSelfLockoutAttempt } from "@/lib/auth/self-lockout";
import { z } from "zod";

const StatusSchema = z.object({
  status: z.enum(["Active", "Blacklisted", "Inactive"]),
  reason: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ personnelId: string }> }
) {
  const [user, { personnelId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = StatusSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  if (isSelfLockoutAttempt(user.personnelId, personnelId, parseResult.data.status)) {
    return NextResponse.json({ error: "You can't revoke your own access" }, { status: 400 });
  }

  try {
    const result = await setPersonnelStatus(
      personnelId,
      parseResult.data.status,
      user.personnelId,
      parseResult.data.reason
    );
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update status" },
      { status: 400 }
    );
  }
}
