import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import { z } from "zod";

const StatusSchema = z.object({
  status: z.string().optional(),
  newStatus: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ skuId: string }> }
) {
  try {
    const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = StatusSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json({ error: "New status is required" }, { status: 400 });
    }

    const newStatus = parseResult.data.status || parseResult.data.newStatus;
    if (!newStatus) {
      return NextResponse.json({ error: "New status string is required" }, { status: 400 });
    }

    // The caller's real roles, not session.user.role — that collapses curator, publisher,
    // marketing and payment_admin all into "artist", which handed every one of them the
    // artist path through the transition rules.
    const result = await updateAssetStatusInKanban(skuId, newStatus, {
      roles: user.roles,
      personnelId: user.personnelId,
    });

    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    console.error("Error in status update endpoint:", error);
    // A refusal by the transition rules is an authorization answer, not a malformed request.
    const message = error instanceof Error ? error.message : "Failed to update status";
    const status = /forbidden|not permitted/.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
