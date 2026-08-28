import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { listActiveDrafts, createDraft } from "@/lib/curation/draft-service";

function canCurate(roles: string[], overrides: Record<string, boolean>): boolean {
  const caps = getEffectiveCapabilities(roles, overrides);
  return caps.canAccessCuratorTools || caps.canManageSystemConfig;
}

// GET: this curator's own active drafts (parallel drafts - as many as they
// want in progress at once, not the single-draft Google Forms limit the
// brief-writing complaint this feature answers was about).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !canCurate(session.user.roles || [], session.user.capabilityOverrides || {})) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!session.user.personnelId) {
    return NextResponse.json({ drafts: [] });
  }
  const drafts = await listActiveDrafts(session.user.personnelId);
  return NextResponse.json({ drafts });
}

// POST: start a new draft. Only called on the first real edit in the form,
// not on page load - an untouched form should never leave a phantom draft.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canCurate(session.user.roles || [], session.user.capabilityOverrides || {})) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!session.user.personnelId) {
    return NextResponse.json({ error: "Your account isn't linked to a personnel record - drafts need an owner." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  try {
    const draft = await createDraft(session.user.personnelId, {
      ideaTitle: body.ideaTitle,
      category: body.category,
      trendReasoning: body.trendReasoning,
      sourceLinks: body.sourceLinks,
      moodboardUrls: body.moodboardUrls,
      fieldValues: body.fieldValues,
    });
    return NextResponse.json({ draft });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create draft" }, { status: 400 });
  }
}
