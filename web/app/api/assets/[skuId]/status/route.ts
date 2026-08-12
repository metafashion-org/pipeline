import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
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
    const { skuId } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
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

    const role = session.user.role || "artist";
    const actorId = session.user.personnelId || undefined;

    const result = await updateAssetStatusInKanban(skuId, newStatus, role, actorId);

    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    console.error("Error in status update endpoint:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update status" },
      { status: 400 }
    );
  }
}
