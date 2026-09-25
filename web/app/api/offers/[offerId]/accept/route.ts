import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { acceptOffer } from "@/lib/offers/offer-service";
import { offerErrorResponse } from "@/lib/offers/offer-route-helpers";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

// The artist accepts the offer at the offered deadline. The service checks it's their offer.
export async function POST(_request: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const [{ offerId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const offer = await acceptOffer(offerId, user.personnelId);
    // The agreed deadline is written to the asset, which the uploader queue shows.
    revalidateViews(CACHE_TAGS.publisherQueue);
    return NextResponse.json({ offer });
  } catch (error) {
    return offerErrorResponse(error, "Failed to accept the offer");
  }
}
