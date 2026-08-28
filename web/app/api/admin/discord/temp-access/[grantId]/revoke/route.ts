import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordManagerTier } from "@/lib/auth/rbac";
import { isConfigured, revokeTempAccessGrant } from "@/lib/discord/team-service";

export async function POST(_request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  const [{ grantId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session || !isDiscordManagerTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Discord not configured on this deployment." }, { status: 500 });
  }

  try {
    const result = await revokeTempAccessGrant(grantId);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to revoke grant" }, { status: 500 });
  }
}
