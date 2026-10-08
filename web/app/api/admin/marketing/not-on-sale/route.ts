import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canPutOnSale, listNotOnSale } from "@/lib/publisher/on-sale-service";

export const dynamic = "force-dynamic";

// The Marketing page's "Variants not on sale" list: live assets with a recolour off sale. Only Arjun
// (admin) puts recolours on sale, so only he gets the list.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canPutOnSale(user.roles)) return NextResponse.json({ error: "Only Arjun puts recolours on sale" }, { status: 403 });
  return NextResponse.json({ assets: await listNotOnSale() });
}
