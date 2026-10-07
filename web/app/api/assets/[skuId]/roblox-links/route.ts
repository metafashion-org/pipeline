import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { errorMessage } from "@/lib/errors";
import { addRobloxLink, canPutOnSale, listRobloxLinks, OnSaleError } from "@/lib/publisher/on-sale-service";

export const dynamic = "force-dynamic";

const AddLinkSchema = z.object({
  url: z.string().min(1).max(500),
  variantLabel: z.string().max(200).nullable().optional(),
});

// An asset's Roblox links, one per uploaded recolour, for the card's Roblox links section. Anyone
// signed in can read them: they are public Roblox catalog links. `canPutOnSale` tells the card
// whether to show the on-sale ticks and Done.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const [user, { skuId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ links: await listRobloxLinks(skuId), canPutOnSale: canPutOnSale(user.roles), canAddLinks: user.caps.canPublishToRoblox });
  } catch (error) {
    if (error instanceof OnSaleError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

// Adds the link of a recolour uploaded after the asset went live. The uploaders, same as the
// Upload queue (canPublishToRoblox).
export async function POST(request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const [user, { skuId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canPublishToRoblox) return NextResponse.json({ error: "Only the uploaders add Roblox links" }, { status: 403 });
  const body = AddLinkSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Paste a Roblox catalog link" }, { status: 400 });
  try {
    const link = await addRobloxLink(skuId, body.data.url, body.data.variantLabel ?? null, user.personnelId ?? null);
    return NextResponse.json({ link });
  } catch (error) {
    if (error instanceof OnSaleError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: errorMessage(error, "Couldn't add the link") }, { status: 500 });
  }
}
