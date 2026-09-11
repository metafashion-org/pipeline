import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { canManageKnowledge, getEffectiveCapabilities } from "@/lib/auth/rbac";
import {
  unlinkArtifactFromSku,
  unlinkArtifactFromCategory,
  unlinkArtifactFromGuideline,
  unlinkArtifactFromStyleSystem,
  unlinkArtifactFromCampaign,
  unlinkArtifactFromAssignment,
} from "@/lib/knowledge/artifact-links-service";


const UNLINK_BY_TYPE: Record<string, (linkId: string, actorId?: string) => Promise<void>> = {
  sku: unlinkArtifactFromSku,
  category: unlinkArtifactFromCategory,
  guideline: unlinkArtifactFromGuideline,
  styleSystem: unlinkArtifactFromStyleSystem,
  campaign: unlinkArtifactFromCampaign,
  assignment: unlinkArtifactFromAssignment,
};

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string; linkType: string; linkId: string }> }
) {
  const [{ linkType, linkId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session || !canManageKnowledge(getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {}))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const unlink = UNLINK_BY_TYPE[linkType];
  if (!unlink) {
    return NextResponse.json({ error: `Unknown link type "${linkType}"` }, { status: 400 });
  }

  try {
    await unlink(linkId, session.user.personnelId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to remove link" }, { status: 400 });
  }
}
