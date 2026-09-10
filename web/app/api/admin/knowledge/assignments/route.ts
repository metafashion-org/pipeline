import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { canManageKnowledge, getEffectiveCapabilities } from "@/lib/auth/rbac";
import { getAssetAssignmentHistory } from "@/lib/kanban/assignment-service";

// Lists one asset's assignment history (current + past) so the Knowledge
// Links dialog can offer "link to this specific artist brief" - a brief is
// the content of one assignment (assignments.briefNotes/deadline/fee), so
// picking which brief to link to means picking which assignment.
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const caps = getEffectiveCapabilities(session?.user?.roles || [], session?.user?.capabilityOverrides || {});
  if (!session || !canManageKnowledge(caps)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const assetId = new URL(request.url).searchParams.get("assetId");
  if (!assetId) return NextResponse.json({ error: "assetId query param is required" }, { status: 400 });

  const assignments = await getAssetAssignmentHistory(assetId);
  return NextResponse.json({ assignments });
}
