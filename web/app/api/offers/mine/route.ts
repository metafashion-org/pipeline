import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getOpenOffersForArtist } from "@/lib/offers/offer-service";
import { MAX_DEADLINE_EXTENSION_DAYS } from "@/lib/offers/offer-rules";

export const dynamic = "force-dynamic";

// The signed-in artist's offers that still need their answer or the team's decision, for My Tasks.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.personnelId) return NextResponse.json({ offers: [], maxExtensionDays: MAX_DEADLINE_EXTENSION_DAYS });

  const offers = await getOpenOffersForArtist(user.personnelId);
  return NextResponse.json({ offers, maxExtensionDays: MAX_DEADLINE_EXTENSION_DAYS });
}
