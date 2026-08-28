import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordManagerTier } from "@/lib/auth/rbac";
import { isConfigured, archiveChannel } from "@/lib/discord/team-service";
import { z } from "zod";

const ArchiveSchema = z.object({ channelId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !isDiscordManagerTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Discord not configured on this deployment." }, { status: 500 });
  }

  const body = await request.json();
  const parseResult = ArchiveSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    await archiveChannel(parseResult.data.channelId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to archive channel" }, { status: 400 });
  }
}
