import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canManageKnowledge } from "@/lib/auth/rbac";
import { ArtifactLinkError, ArtifactNotFoundError, updateArtifactDocLink } from "@/lib/knowledge/artifacts-service";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

export const dynamic = "force-dynamic";

const MAX_URL_CHARS = 2_000;
const BodySchema = z.object({ url: z.string().trim().min(1).max(MAX_URL_CHARS) });

/** Changes the Google Doc an artifact links to. Only Google Docs are accepted. */
export async function PUT(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const [{ artifactId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageKnowledge(user.caps)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!z.uuid().safeParse(artifactId).success) return NextResponse.json({ error: "Unknown artifact" }, { status: 400 });
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Paste a Google Doc link" }, { status: 400 });

  try {
    await updateArtifactDocLink(artifactId, body.data.url, user.personnelId ?? null);
    revalidateViews(CACHE_TAGS.knowledge);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ArtifactLinkError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof ArtifactNotFoundError) return NextResponse.json({ error: "That artifact isn't in the Registry" }, { status: 404 });
    throw error;
  }
}
