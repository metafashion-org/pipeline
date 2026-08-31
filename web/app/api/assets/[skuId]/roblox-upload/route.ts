import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { recordRobloxUpload } from "@/lib/publisher/publisher-service";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { z } from "zod";

const RobloxUploadSchema = z.object({
  robloxItemUrl: z.string().trim().min(1),
  robloxAssetId: z.string().trim().min(1).optional(),
  uploadNotes: z.string().trim().min(1).optional(),
});

/**
 * The brief's §9 Uploader flow: records the Roblox marketplace link for an
 * asset that's Ready for Upload, advancing it to Uploaded to Roblox.
 * recordRobloxUpload's own status gate (fromStatus must be
 * ready_for_upload) does the real enforcement; this route only adds the
 * permission check and request validation on top.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ skuId: string }> }
) {
  const [{ skuId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {});
  if (!caps.canPublishToRoblox) {
    return NextResponse.json({ error: "You don't have permission to publish to Roblox" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = RobloxUploadSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const result = await recordRobloxUpload({
      sku: skuId,
      publisherId: session.user.personnelId,
      robloxItemUrl: parseResult.data.robloxItemUrl,
      robloxAssetId: parseResult.data.robloxAssetId,
      uploadNotes: parseResult.data.uploadNotes,
    });
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record Roblox upload" },
      { status: 400 }
    );
  }
}
