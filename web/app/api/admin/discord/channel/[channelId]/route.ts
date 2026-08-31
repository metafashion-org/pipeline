import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordAdminTier } from "@/lib/auth/rbac";
import { isConfigured, deleteChannelPermanently } from "@/lib/discord/team-service";

// Permanent delete - admin tier only, distinct from archive (which is
// reversible via restore-channel). No undo here, matching Discord's own
// DELETE /channels/{id} semantics.
export async function DELETE(_request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const [{ channelId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session || !isDiscordAdminTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Discord not configured on this deployment." }, { status: 500 });
  }

  try {
    await deleteChannelPermanently(channelId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete channel" }, { status: 400 });
  }
}
