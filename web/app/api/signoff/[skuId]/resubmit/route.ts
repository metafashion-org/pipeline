import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { resubmitSignoff } from "@/lib/signoff/signoff-service";
import { canAddAssets } from "@/lib/auth/rbac";
import { signoffActor, signoffErrorResponse } from "../../signoff-route-helpers";

export const dynamic = "force-dynamic";

/** Sends a sent-back asset to Arjun again. Whoever added it, or an admin (the service checks). */
export async function POST(_request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAddAssets(user.caps)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    await resubmitSignoff(skuId, signoffActor(user));
    return NextResponse.json({ success: true });
  } catch (error) {
    return signoffErrorResponse(error);
  }
}
