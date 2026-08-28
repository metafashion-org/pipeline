import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordAdminTier } from "@/lib/auth/rbac";
import { isConfigured, setChannelBucketPermission } from "@/lib/discord/team-service";
import { z } from "zod";

const ChannelPermissionSchema = z.object({
  channelId: z.string().min(1),
  bucket: z.enum(["manager", "curator"]),
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
  const parseResult = ChannelPermissionSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    await setChannelBucketPermission(parseResult.data.channelId, parseResult.data.bucket, parseResult.data.enabled);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update permission" }, { status: 400 });
  }
}
