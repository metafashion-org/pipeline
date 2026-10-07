import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { errorMessage } from "@/lib/errors";
import { canPutOnSale, finishPutOnSale, OnSaleError } from "@/lib/publisher/on-sale-service";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

// Done on a Payment Done card: moves it to Put on Sale, with whichever recolours are ticked on sale.
// Only Arjun (admin); the move also goes through the payment_done -> put_on_sale rule.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const [user, { skuId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canPutOnSale(user.roles)) return NextResponse.json({ error: "Only Arjun puts assets on sale" }, { status: 403 });
  try {
    await finishPutOnSale(skuId, { roles: user.roles, personnelId: user.personnelId, caps: user.caps });
  } catch (error) {
    const status = error instanceof OnSaleError ? 400 : 500;
    return NextResponse.json({ error: errorMessage(error, "Couldn't move it to Put on Sale") }, { status });
  }
  // The marketing views list live assets by status, as after any status change (status/route.ts).
  revalidateViews(CACHE_TAGS.marketing);
  return NextResponse.json({ ok: true });
}
