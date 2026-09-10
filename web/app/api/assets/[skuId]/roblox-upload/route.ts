import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { recordRobloxUpload } from "@/lib/publisher/publisher-service";
import { parseRobloxLinkLines } from "@/lib/publisher/roblox-links";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";
import { z } from "zod";

// One Roblox catalog link per entry, in the order the uploader added them, so a rejection can name the line they typed. The old shape took a single robloxItemUrl plus a robloxAssetId the uploader copied out of it by hand; the id now comes from the link itself.
const RobloxUploadSchema = z.object({
  robloxItemUrls: z.array(z.string()).min(1, "At least one Roblox item URL is required"),
  uploadNotes: z.string().trim().min(1).optional(),
});

/**
 * The brief's §9 Uploader flow: records the Roblox marketplace links for an
 * asset that's Ready for Upload, advancing it to Uploaded to Roblox.
 * recordRobloxUpload's own status gate (fromStatus must be
 * ready_for_upload) does the real enforcement; this route only adds the
 * permission check and request validation on top.
 *
 * Input: { robloxItemUrls: string[] } on an asset SKU. Output: 200 with the recorded links, or 400 with an `invalidLines` array naming each line that failed and why.
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

  // Checked here rather than only inside the service so the response can carry the failing lines as structured data, which is what the queue renders next to the offending entries.
  const { valid, invalid } = parseRobloxLinkLines(parseResult.data.robloxItemUrls);
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: `${invalid.length} link${invalid.length === 1 ? "" : "s"} didn't validate.`,
        invalidLines: invalid,
      },
      { status: 400 }
    );
  }
  if (valid.length === 0) {
    return NextResponse.json({ error: "At least one Roblox item URL is required" }, { status: 400 });
  }

  try {
    const result = await recordRobloxUpload({
      sku: skuId,
      publisherId: session.user.personnelId,
      robloxItemUrls: parseResult.data.robloxItemUrls,
      uploadNotes: parseResult.data.uploadNotes,
    });
    // The asset leaves the Ready for Upload queue and arrives in Marketing's "uploaded but not marketed" list, so both cached views are now out of date.
    revalidateViews(CACHE_TAGS.publisherQueue, CACHE_TAGS.marketing);
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record Roblox upload" },
      { status: 400 }
    );
  }
}
