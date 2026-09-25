import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { declineOffer } from "@/lib/offers/offer-service";
import { offerErrorResponse } from "@/lib/offers/offer-route-helpers";

const DeclineSchema = z.object({
  // Optional: asked for so the team can see what makes artists turn work down.
  reason: z.string().trim().max(1000).optional(),
});

// The artist declines. The asset goes back to Unassigned and the team is emailed the reason.
export async function POST(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const [{ offerId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = DeclineSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "The reason is too long" }, { status: 400 });

  try {
    const offer = await declineOffer(offerId, user.personnelId, parsed.data.reason || null);
    return NextResponse.json({ offer });
  } catch (error) {
    return offerErrorResponse(error, "Failed to decline the offer");
  }
}
