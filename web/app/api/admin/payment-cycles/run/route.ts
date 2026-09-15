import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { ENV } from "@/lib/env";
import { runPaymentCyclePull } from "@/lib/payments/payment-cycle-service";

// Two ways in: an authenticated admin (the "Run pull now" button on /admin/archive),
// or Vercel's own cron invocation, authenticated via a shared CRON_SECRET per
// Vercel's cron-job auth convention (send it as `Authorization: Bearer $CRON_SECRET`
// in vercel.json / the Vercel dashboard). Set CRON_SECRET in the deployment's env
// vars for the cron path to work; without it, only admin sessions can call this.
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (ENV.CRON_SECRET && authHeader === `Bearer ${ENV.CRON_SECRET}`) {
    return true;
  }
  // getAuthedUser returns null for Inactive and Blacklisted personnel, whose sessions stay valid until they expire.
  const user = await getAuthedUser();
  // Running a payment cycle pull is a money action, so it uses the same capability that gates marking payments done.
  return user?.caps.canMarkPaymentDone ?? false;
}

// Shared by both methods: Vercel Cron Jobs invoke this path with GET, while the
// admin "Run pull now" button (components/archive/RunPaymentPullButton.tsx) uses POST.
async function handle(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPaymentCyclePull();
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errorMessage(error, "Failed to run payment cycle pull") },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;
