import { errorMessage } from "@/lib/errors";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { db } from "@/lib/db/client";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { seedArtifactSubmissionFormDefinition, processArtifactSubmission, type ArtifactSubmissionValues } from "@/lib/knowledge/artifact-submission";
import { findArtifactType, getKnowledgeArtifacts, InvalidTrendLinkError } from "@/lib/knowledge/artifacts-service";
import { formForPrefix, parseArtifactSubmission } from "@/lib/knowledge/artifact-forms";
import { canManageKnowledge } from "@/lib/auth/rbac";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

// The same gate its sibling link routes already use. Without it these two only checked that a
// session existed, so any signed-in person — an artist, say — could read the whole registry and
// write to it, on a route the rest of /api/admin/knowledge restricts to config managers and
// curators.

export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageKnowledge(user.caps)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const artifacts = await getKnowledgeArtifacts();
  return NextResponse.json({ artifacts });
}

// The New Artifact form sends the type and its fields' values keyed by field key
// (lib/knowledge/artifact-forms.ts), which parseArtifactSubmission checks against that type's form.
const NewArtifactSchema = z.object({
  artifactTypeId: z.uuid(),
  values: z.record(z.string(), z.unknown()),
});

// Per the brief's §7: "Artifacts are added through a dedicated knowledge
// submission form... Each submitted artifact goes into the Knowledge
// Registry" — reads as direct entry, not a pending-approval queue (unlike
// personnel onboarding, which does hold for admin review). So this creates
// the form_submissions row AND processes it in the same request, reusing
// the exact same tested path (seedArtifactSubmissionFormDefinition +
// processArtifactSubmission) rather than a separate, untested shortcut.
export async function POST(req: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canManageKnowledge(user.caps)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const body = NewArtifactSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Pick a type and fill in the form" }, { status: 400 });

  const type = await findArtifactType(body.data.artifactTypeId);
  if (!type || !type.isActive) return NextResponse.json({ error: "That artifact type isn't available" }, { status: 400 });

  const parsed = parseArtifactSubmission(formForPrefix(type.prefix), body.data.values);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const values: ArtifactSubmissionValues = { artifactTypeId: type.id, ...parsed.submission };

  const defId = await seedArtifactSubmissionFormDefinition();

  const [submission] = await db
    .insert(formSubmissions)
    .values({
      formDefinitionId: defId,
      submitterId: user.personnelId || null,
      submitterEmail: user.email,
      values,
      status: "pending",
    })
    .returning();

  try {
    const artifact = await processArtifactSubmission(submission.id, user.personnelId || undefined);
    // A new artifact changes both the registry view and the forms view's submission count.
    revalidateViews(CACHE_TAGS.knowledge, CACHE_TAGS.forms);
    return NextResponse.json({ artifact });
  } catch (e: unknown) {
    if (e instanceof InvalidTrendLinkError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: errorMessage(e, "Failed to create artifact") }, { status: 500 });
  }
}
