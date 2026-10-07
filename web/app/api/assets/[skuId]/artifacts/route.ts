import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { seesBusinessDetails } from "@/lib/auth/rbac";
import { getArtifactsForAsset } from "@/lib/knowledge/artifact-links-service";

// The other end of artifact_sku_links: knowledge relevant to THIS specific
// asset, surfaced where someone actually looks at the asset (AssetDrawer) -
// per the brief's §7, the whole point of linking is "reuse knowledge
// instead of rewriting context for every asset." getArtifactsForAsset
// existed since the original build but had no route anywhere calling it.
export async function GET(_request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Registry research is how we pick items; artists don't see it (seesBusinessDetails).
  if (!seesBusinessDetails(user.caps)) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const artifacts = await getArtifactsForAsset(skuId);
  return NextResponse.json({ artifacts });
}
