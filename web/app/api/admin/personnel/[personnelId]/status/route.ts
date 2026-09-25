import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { setPersonnelStatus } from "@/lib/forms/onboarding";
import { isSelfLockoutAttempt } from "@/lib/auth/self-lockout";
import { ADMIN_ONLY_MESSAGE, isAdminAccessChangeByNonAdmin } from "@/lib/auth/admin-guard";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { eq } from "drizzle-orm";
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
  if (!user.caps.canManagePersonnel) {
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

  const [target] = await db.select({ roles: personnel.roles }).from(personnel).where(eq(personnel.id, personnelId)).limit(1);
  if (!target) {
    return NextResponse.json({ error: "Personnel not found" }, { status: 404 });
  }
  if (isAdminAccessChangeByNonAdmin(user.caps, target.roles)) {
    return NextResponse.json({ error: ADMIN_ONLY_MESSAGE }, { status: 403 });
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
      { error: errorMessage(error, "Failed to update status") },
      { status: 400 }
    );
  }
}
