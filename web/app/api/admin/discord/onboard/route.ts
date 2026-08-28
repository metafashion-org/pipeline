import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordManagerTier } from "@/lib/auth/rbac";
import { isConfigured, onboardMember } from "@/lib/discord/team-service";
import { z } from "zod";

const OnboardSchema = z.object({
  name: z.string().trim().min(1),
  username: z.string().trim().min(1),
  department: z.string().trim().min(1),
  alsoAddShared: z.boolean().optional(),
  managerVisible: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !isDiscordManagerTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Discord not configured on this deployment." }, { status: 500 });
  }

  const body = await request.json();
  const parseResult = OnboardSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const result = await onboardMember(parseResult.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to onboard member" }, { status: 400 });
  }
}
