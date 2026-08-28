import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { submitFinalDeliverables } from "@/lib/deliverables/deliverables-service";
import { eq } from "drizzle-orm";
import { z } from "zod";

const SubmitFinalSchema = z.object({
  fileUrls: z.array(z.string().trim().min(1)).min(1),
  notes: z.string().trim().min(1).optional(),
});

/**
 * The brief's §8 final-file handoff: the assigned artist submits final files
 * once an asset is Approved. This route (and submitFinalDeliverables's
 * status/file validation it calls into) didn't exist before — the service
 * function was fully orphaned. Permission is identity-based, not role-based:
 * admins/operators can submit on anyone's behalf, but an artist can only
 * submit for an asset actually assigned to them, checked against
 * assets.currentArtistId server-side rather than trusting the client.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ skuId: string }> }
) {
  const [{ skuId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parseResult = SubmitFinalSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const assetRecord = await db
    .select({ id: assets.id, currentArtistId: assets.currentArtistId })
    .from(assets)
    .where(eq(assets.sku, skuId))
    .limit(1);

  if (assetRecord.length === 0) {
    return NextResponse.json({ error: `Asset with SKU '${skuId}' not found` }, { status: 404 });
  }

  const roles = session.user.roles || [];
  const isAdminOrOperator = roles.includes("admin") || roles.includes("operator");
  const isAssignedArtist =
    Boolean(session.user.personnelId) && session.user.personnelId === assetRecord[0].currentArtistId;
  if (!isAdminOrOperator && !isAssignedArtist) {
    return NextResponse.json({ error: "Only the assigned artist (or an admin/operator) can submit final files" }, { status: 403 });
  }

  try {
    const result = await submitFinalDeliverables(
      skuId,
      parseResult.data.fileUrls,
      session.user.personnelId,
      parseResult.data.notes
    );
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to submit final files" },
      { status: 400 }
    );
  }
}
