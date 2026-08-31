import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordManagerTier } from "@/lib/auth/rbac";
import { isConfigured, listTempAccessGrants, grantTempAccess } from "@/lib/discord/team-service";
import { z } from "zod";

const GrantSchema = z.object({
  channelId: z.string().min(1),
  channelName: z.string().optional(),
  granteeType: z.enum(["user", "role"]),
  granteeId: z.string().min(1),
  granteeName: z.string().optional(),
  days: z.number().int().min(1),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !isDiscordManagerTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const grants = await listTempAccessGrants();
    return NextResponse.json({ grants });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load temp access grants" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !isDiscordManagerTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Discord not configured on this deployment." }, { status: 500 });
  }

  const body = await request.json();
  const parseResult = GrantSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const grant = await grantTempAccess({ ...parseResult.data, grantedBy: session.user.name || session.user.email || null });
    return NextResponse.json({ ok: true, grant });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to grant temp access" }, { status: 400 });
  }
}
