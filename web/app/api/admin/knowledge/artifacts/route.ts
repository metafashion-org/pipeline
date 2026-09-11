import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { seedArtifactSubmissionFormDefinition, processArtifactSubmission, ArtifactSubmissionValues } from "@/lib/knowledge/artifact-submission";
import { getKnowledgeArtifacts } from "@/lib/knowledge/artifacts-service";
import { canManageKnowledge, getEffectiveCapabilities } from "@/lib/auth/rbac";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

// The same gate its sibling link routes already use. Without it these two only checked that a
// session existed, so any signed-in person — an artist, say — could read the whole registry and
// write to it, on a route the rest of /api/admin/knowledge restricts to config managers and
// curators.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageKnowledge(getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {}))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const artifacts = await getKnowledgeArtifacts();
  return NextResponse.json({ artifacts });
}

// Per the brief's §7: "Artifacts are added through a dedicated knowledge
// submission form... Each submitted artifact goes into the Knowledge
// Registry" — reads as direct entry, not a pending-approval queue (unlike
// personnel onboarding, which does hold for admin review). So this creates
// the form_submissions row AND processes it in the same request, reusing
// the exact same tested path (seedArtifactSubmissionFormDefinition +
// processArtifactSubmission) rather than a separate, untested shortcut.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageKnowledge(getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {}))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = (await req.json()) as ArtifactSubmissionValues;
  if (!body.artifactTypeId) return NextResponse.json({ error: "artifactTypeId is required" }, { status: 400 });
  if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const defId = await seedArtifactSubmissionFormDefinition();

  const [submission] = await db
    .insert(formSubmissions)
    .values({
      formDefinitionId: defId,
      submitterId: session.user.personnelId || null,
      submitterEmail: session.user.email || null,
      values: body,
      status: "pending",
    })
    .returning();

  try {
    const artifact = await processArtifactSubmission(submission.id, session.user.personnelId || undefined);
    // A new artifact changes both the registry view and the forms view's submission count.
    revalidateViews(CACHE_TAGS.knowledge, CACHE_TAGS.forms);
    return NextResponse.json({ artifact });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create artifact" }, { status: 500 });
  }
}
