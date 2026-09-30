import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canManageKnowledge } from "@/lib/auth/rbac";
import { archiveKnowledgeArtifact, ArtifactNotFoundError } from "@/lib/knowledge/artifacts-service";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

export const dynamic = "force-dynamic";

const ArtifactIdSchema = z.uuid();

/**
 * Takes an artifact out of the Registry. Nothing is deleted: the row, its ID and its links stay in
 * the database, and audit_log records who archived it.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const [{ artifactId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageKnowledge(user.caps)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!ArtifactIdSchema.safeParse(artifactId).success) return NextResponse.json({ error: "Unknown artifact" }, { status: 400 });

  try {
    const archivedId = await archiveKnowledgeArtifact(artifactId, user.personnelId ?? null);
    revalidateViews(CACHE_TAGS.knowledge);
    return NextResponse.json({ archived: archivedId });
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) return NextResponse.json({ error: "That artifact isn't in the Registry" }, { status: 404 });
    throw error;
  }
}
