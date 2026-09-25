import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { approveDeadlineExtension } from "@/lib/offers/offer-service";
import { offerErrorResponse } from "@/lib/offers/offer-route-helpers";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

// The team approves an artist's requested deadline. Same permission as assigning artists.
export async function POST(_request: Request, { params }: { params: Promise<{ offerId: string }> }) {
  const [{ offerId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) {
    return NextResponse.json({ error: "You don't have permission to decide deadline requests" }, { status: 403 });
  }

  try {
    const offer = await approveDeadlineExtension(offerId, user.personnelId);
    revalidateViews(CACHE_TAGS.publisherQueue);
    return NextResponse.json({ offer });
  } catch (error) {
    return offerErrorResponse(error, "Failed to approve the deadline");
  }
}
