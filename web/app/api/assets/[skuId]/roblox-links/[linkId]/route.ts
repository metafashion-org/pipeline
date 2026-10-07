import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canPutOnSale, OnSaleError, setLinkOnSale } from "@/lib/publisher/on-sale-service";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

const OnSaleSchema = z.object({ onSale: z.boolean() });

// Ticks one recolour's Roblox link on or off sale. Only Arjun (admin) puts things on sale.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ skuId: string; linkId: string }> }) {
  const [user, { skuId, linkId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canPutOnSale(user.roles)) return NextResponse.json({ error: "Only Arjun puts recolours on sale" }, { status: 403 });
  const body = OnSaleSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Say whether it's on sale" }, { status: 400 });
  try {
    await setLinkOnSale(skuId, linkId, body.data.onSale, user.personnelId ?? null);
    // The Marketing page lists an asset for marketing once a recolour is on sale.
    revalidateViews(CACHE_TAGS.marketing);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof OnSaleError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
