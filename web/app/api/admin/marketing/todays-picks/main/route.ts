import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner, setMainListing, TodaysPicksError } from "@/lib/marketing/todays-picks-service";

const MainSchema = z.object({ sku: z.string().min(1), linkId: z.string().uuid().nullable() });

// Picks a SKU's main listing (the link a nomination uses), or clears it with linkId null.
export async function PUT(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTodaysPicksOwner(user.email)) return NextResponse.json({ error: "Today's Picks is Arjun's own workflow" }, { status: 403 });
  const body = MainSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Give the SKU and the listing" }, { status: 400 });
  try {
    await setMainListing(body.data.sku, body.data.linkId, user.personnelId ?? null);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof TodaysPicksError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
