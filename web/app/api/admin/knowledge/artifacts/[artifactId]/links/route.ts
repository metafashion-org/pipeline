import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { canManageKnowledge, getEffectiveCapabilities } from "@/lib/auth/rbac";
import {
  getLinksForArtifact,
  linkArtifactToSku,
  linkArtifactToCategory,
  linkArtifactToGuideline,
  linkArtifactToStyleSystem,
  linkArtifactToCampaign,
  linkArtifactToAssignment,
} from "@/lib/knowledge/artifact-links-service";
import { z } from "zod";


// One artifact's links across all 6 of the brief's §7 "attachable to"
// surfaces (SKUs, categories, artist briefs, style systems, marketing
// campaigns, technical guideline libraries) - a single aggregate read,
// see getLinksForArtifact.
export async function GET(_request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const [{ artifactId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session || !canManageKnowledge(getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {}))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const links = await getLinksForArtifact(artifactId);
  return NextResponse.json({ links });
}

const LinkSchema = z.object({
  type: z.enum(["sku", "category", "guideline", "styleSystem", "campaign", "assignment"]),
  value: z.string().trim().min(1),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ artifactId: string }> }) {
  const [{ artifactId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session || !canManageKnowledge(getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {}))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parseResult = LinkSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const actorId = session.user.personnelId;
  const { type, value } = parseResult.data;

  try {
    switch (type) {
      case "sku":
        await linkArtifactToSku(artifactId, value, actorId);
        break;
      case "category":
        await linkArtifactToCategory(artifactId, value, actorId);
        break;
      case "guideline":
        await linkArtifactToGuideline(artifactId, value, actorId);
        break;
      case "styleSystem":
        await linkArtifactToStyleSystem(artifactId, value, actorId);
        break;
      case "campaign":
        await linkArtifactToCampaign(artifactId, value, actorId);
        break;
      case "assignment":
        await linkArtifactToAssignment(artifactId, value, actorId);
        break;
    }
    const links = await getLinksForArtifact(artifactId);
    return NextResponse.json({ links });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create link" }, { status: 400 });
  }
}
