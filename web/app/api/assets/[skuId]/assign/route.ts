import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { assignArtistToAsset } from "@/lib/kanban/assignment-service";
import { updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { eq } from "drizzle-orm";
import { z } from "zod";

const AssignSchema = z.object({
  artistId: z.string().uuid(),
  feeAmount: z.string().trim().min(1).optional(),
  ccEmails: z.array(z.string().email()).optional(),
  reason: z.string().trim().min(1).optional(),
});

/**
 * Assigns or reassigns an artist to an asset identified by SKU.
 * Reassignment is the same call as a first assignment: assignArtistToAsset deactivates any previous active assignment, records the new one, updates assets.current_artist_id, queues the brief email and writes an audit entry.
 * A first assignment also advances an asset that is still `unassigned` to `assigned`, through the normal transition-rule path so the move is validated and written to status history like any other; assets already further along the pipeline keep their current status.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ skuId: string }> }
) {
  const { skuId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {});
  if (!caps.canAssignArtists) {
    return NextResponse.json({ error: "You don't have permission to assign artists" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = AssignSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const assetRecord = await db
      .select({ id: assets.id, currentStatus: assets.currentStatus })
      .from(assets)
      .where(eq(assets.sku, skuId))
      .limit(1);

    if (assetRecord.length === 0) {
      return NextResponse.json({ error: `Asset with SKU '${skuId}' not found` }, { status: 404 });
    }

    const result = await assignArtistToAsset({
      assetId: assetRecord[0].id,
      artistId: parseResult.data.artistId,
      feeAmount: parseResult.data.feeAmount,
      ccEmails: parseResult.data.ccEmails || [],
      actorId: session.user.personnelId,
      reason: parseResult.data.reason,
    });

    if (assetRecord[0].currentStatus === "unassigned") {
      await updateAssetStatusInKanban(
        skuId,
        "assigned",
        session.user.role,
        session.user.personnelId,
        "Artist assigned via Kanban"
      );
    }

    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    console.error("Error assigning artist:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to assign artist" },
      { status: 400 }
    );
  }
}
