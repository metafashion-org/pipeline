import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { restoreDraftVersion } from "@/lib/curation/draft-service";

function canCurate(roles: string[], overrides: Record<string, boolean>): boolean {
  const caps = getEffectiveCapabilities(roles, overrides);
  return caps.canAccessCuratorTools || caps.canManageSystemConfig;
}

export async function POST(_request: Request, { params }: { params: Promise<{ draftId: string; versionId: string }> }) {
  const [{ draftId, versionId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session || !canCurate(session.user.roles || [], session.user.capabilityOverrides || {})) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  if (!session.user.personnelId) {
    return NextResponse.json({ error: "Your account isn't linked to a personnel record." }, { status: 400 });
  }

  try {
    const draft = await restoreDraftVersion(draftId, session.user.personnelId, versionId);
    return NextResponse.json({ draft });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to restore version" }, { status: 400 });
  }
}
