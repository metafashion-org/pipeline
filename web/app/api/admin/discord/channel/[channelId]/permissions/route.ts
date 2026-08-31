import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordManagerTier } from "@/lib/auth/rbac";
import { isConfigured, getChannelPermissionDetail } from "@/lib/discord/team-service";

export async function GET(_request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const [{ channelId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session || !isDiscordManagerTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Discord not configured on this deployment." }, { status: 500 });
  }

  try {
    const detail = await getChannelPermissionDetail(channelId);
    return NextResponse.json(detail);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load channel permissions" }, { status: 400 });
  }
}
