import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canPutOnSale, listNotOnSale } from "@/lib/publisher/on-sale-service";

export const dynamic = "force-dynamic";

// The Marketing page's "Not on sale yet" list: live assets with no recolour on sale. Only Arjun
// (admin) puts recolours on sale, so only he gets the list.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canPutOnSale(user.roles)) return NextResponse.json({ error: "Only Arjun puts recolours on sale" }, { status: 403 });
  return NextResponse.json({ assets: await listNotOnSale() });
}
