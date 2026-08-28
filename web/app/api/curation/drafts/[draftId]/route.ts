import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { saveDraft, discardDraft } from "@/lib/curation/draft-service";

function canCurate(roles: string[], overrides: Record<string, boolean>): boolean {
  const caps = getEffectiveCapabilities(roles, overrides);
  return caps.canAccessCuratorTools || caps.canManageSystemConfig;
}

// PATCH: autosave/manual save. Always updates the live draft row in place -
// this is the "no redundant drafts" half of the ask, the client already
// knows which draft it's editing, so a save is never mistaken for a new one.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }) {
  const [{ draftId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session || !canCurate(session.user.roles || [], session.user.capabilityOverrides || {})) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!session.user.personnelId) {
    return NextResponse.json({ error: "Your account isn't linked to a personnel record." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  try {
    const result = await saveDraft(draftId, session.user.personnelId, {
      ideaTitle: body.ideaTitle,
      category: body.category,
      trendReasoning: body.trendReasoning,
      sourceLinks: body.sourceLinks,
      moodboardUrls: body.moodboardUrls,
      fieldValues: body.fieldValues,
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save draft" }, { status: 400 });
  }
}

// DELETE: discard - the curator abandoned this idea, nothing to keep.
export async function DELETE(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const [{ draftId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session || !canCurate(session.user.roles || [], session.user.capabilityOverrides || {})) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!session.user.personnelId) {
    return NextResponse.json({ error: "Your account isn't linked to a personnel record." }, { status: 400 });
  }

  try {
    await discardDraft(draftId, session.user.personnelId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to discard draft" }, { status: 400 });
  }
}
