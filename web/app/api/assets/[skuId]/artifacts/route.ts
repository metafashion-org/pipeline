import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getArtifactsForAsset } from "@/lib/knowledge/artifact-links-service";

// The other end of artifact_sku_links: knowledge relevant to THIS specific
// asset, surfaced where someone actually looks at the asset (AssetDrawer) -
// per the brief's §7, the whole point of linking is "reuse knowledge
// instead of rewriting context for every asset." getArtifactsForAsset
// existed since the original build but had no route anywhere calling it.
export async function GET(_request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const artifacts = await getArtifactsForAsset(skuId);
  return NextResponse.json({ artifacts });
}
