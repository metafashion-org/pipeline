import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canPutOnSale } from "@/lib/publisher/on-sale-service";
import { listTodaysPicksPreview } from "@/lib/marketing/todays-picks-service";
import { getTodaysPicksSheet } from "@/lib/marketing/todays-picks-sheet";

export const dynamic = "force-dynamic";

// The Today's Picks preview: live SKUs, their listings with thumbnails and Roblox checks, and the
// private sheet's link. Arjun's own workflow, so admins only, like putting recolours on sale.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canPutOnSale(user.roles)) return NextResponse.json({ error: "Only Arjun sees the Today's Picks preview" }, { status: 403 });
  const [items, sheet] = await Promise.all([listTodaysPicksPreview(), getTodaysPicksSheet()]);
  return NextResponse.json({ items, sheetUrl: sheet?.url ?? null });
}
