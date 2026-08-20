import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
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
  const [session, { personnelId }] = await Promise.all([getServerSession(authOptions), params]);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parseResult = StatusSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  if (isSelfLockoutAttempt(session.user.personnelId, personnelId, parseResult.data.status)) {
    return NextResponse.json({ error: "You can't revoke your own access" }, { status: 400 });
  }

  try {
    const result = await setPersonnelStatus(
      personnelId,
      parseResult.data.status,
      session.user.personnelId,
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
