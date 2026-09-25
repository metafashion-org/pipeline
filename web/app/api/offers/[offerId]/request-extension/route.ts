import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { requestDeadlineExtension } from "@/lib/offers/offer-service";
import { offerErrorResponse } from "@/lib/offers/offer-route-helpers";

const RequestSchema = z.object({
  // A calendar date as the date input sends it, YYYY-MM-DD.
  requestedDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(1000).optional(),
});

// The artist asks for a later deadline. The service checks it's their offer and the date is in range.
export async function POST(request: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  const [{ offerId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = RequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick the date you need" }, { status: 400 });

  try {
    const offer = await requestDeadlineExtension(
      offerId,
      user.personnelId,
      new Date(parsed.data.requestedDeadline),
      parsed.data.reason || null
    );
    return NextResponse.json({ offer });
  } catch (error) {
    return offerErrorResponse(error, "Failed to request a new deadline");
  }
}
