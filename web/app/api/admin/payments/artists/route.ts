import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getArtistsPendingPayment } from "@/lib/payments/payment-batch-service";

export const dynamic = "force-dynamic";

// Read side of the artist-grouped payments view — replaces the old payment_cycles snapshot the
// Archive page used to read. Gated on canMarkPaymentDone since this exposes exact fee amounts,
// same capability the write side (attach route) requires.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canMarkPaymentDone) {
    return NextResponse.json({ error: "You don't have permission to view payments" }, { status: 403 });
  }

  const artists = await getArtistsPendingPayment();
  return NextResponse.json({ artists });
}
