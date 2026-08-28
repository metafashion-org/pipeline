import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordAdminTier } from "@/lib/auth/rbac";
import { isConfigured, setChannelPermissionBit } from "@/lib/discord/team-service";
import { z } from "zod";

const BitSchema = z.object({
  channelId: z.string().min(1),
  roleId: z.string().min(1),
  bit: z.enum(["view", "send", "attach", "embed", "history"]),
  enabled: z.boolean(),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !isDiscordAdminTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Discord not configured on this deployment." }, { status: 500 });
  }

  const body = await request.json();
  const parseResult = BitSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const { channelId, roleId, bit, enabled } = parseResult.data;
    await setChannelPermissionBit(channelId, roleId, bit, enabled);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update permission bit" }, { status: 400 });
  }
}
