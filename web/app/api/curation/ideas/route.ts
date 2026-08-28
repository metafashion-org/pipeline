import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { submitCurationItemIdea, getCurationFieldConfigs } from "@/lib/curation/curation-service";

function canCurate(roles: string[], overrides: Record<string, boolean>): boolean {
  const caps = getEffectiveCapabilities(roles, overrides);
  return caps.canAccessCuratorTools || caps.canManageSystemConfig;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !canCurate(session.user.roles || [], session.user.capabilityOverrides || {})) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const fields = await getCurationFieldConfigs();
  return NextResponse.json({ fields });
}

// Per the brief's §6: "A curator or operator adds a curated item idea. The
// system creates or maintains a unique SKU." — this is that entry point.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !canCurate(session.user.roles || [], session.user.capabilityOverrides || {})) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const body = await req.json();
  if (!body.ideaTitle?.trim()) return NextResponse.json({ error: "ideaTitle is required" }, { status: 400 });

  try {
    const result = await submitCurationItemIdea({
      ideaTitle: body.ideaTitle.trim(),
      category: body.category || undefined,
      trendReasoning: body.fieldValues?.trendReasoning || undefined,
      sourceLinks: body.sourceLinks || [],
      moodboardUrls: body.moodboardUrls || [],
      fieldValues: body.fieldValues || {},
      submitterId: session.user.personnelId || undefined,
      // Converts an existing draft (lib/curation/draft-service.ts) in place
      // instead of inserting a second row - see submitCurationItemIdea.
      draftId: body.draftId || undefined,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to submit idea" }, { status: 500 });
  }
}
