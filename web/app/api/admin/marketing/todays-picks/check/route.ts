import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canPutOnSale } from "@/lib/publisher/on-sale-service";
import { checkSkuOnRoblox, TodaysPicksError } from "@/lib/marketing/todays-picks-service";

export const dynamic = "force-dynamic";
// One SKU's listings at one request per second: 7 listings take about 10 seconds.
export const maxDuration = 60;

const CheckSchema = z.object({ sku: z.string().min(1) });

// Checks one SKU's listings on Roblox when Arjun presses the button. Not scheduled: the recurring
// check job is a separate, unapproved stage.
export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canPutOnSale(user.roles)) return NextResponse.json({ error: "Only Arjun runs Roblox checks" }, { status: 403 });
  const body = CheckSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Give the SKU" }, { status: 400 });
  try {
    return NextResponse.json(await checkSkuOnRoblox(body.data.sku, user.personnelId ?? null));
  } catch (error) {
    if (error instanceof TodaysPicksError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
