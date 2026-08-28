import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { notifyUploader } from "@/lib/deliverables/deliverables-service";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { z } from "zod";

const NotifyUploaderSchema = z.object({
  notes: z.string().trim().min(1).optional(),
});

/**
 * The brief's §5 "Uploader notified → Ready for Upload" transition — a real
 * card action and automatic-transition trigger that had no route or UI
 * anywhere before this (notifyUploader itself was just added to
 * deliverables-service.ts, also fully orphaned until now). Gated on
 * canAssignPublisher — admin/operator only, the same capability that governs
 * handing production work to a publisher/uploader elsewhere in this app.
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
  if (!caps.canAssignPublisher) {
    return NextResponse.json({ error: "You don't have permission to notify the uploader" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parseResult = NotifyUploaderSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const result = await notifyUploader(skuId, session.user.personnelId, parseResult.data.notes);
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to notify uploader" },
      { status: 400 }
    );
  }
}
