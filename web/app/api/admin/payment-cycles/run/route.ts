import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { runPaymentCyclePull } from "@/lib/payments/payment-cycle-service";

// Two ways in: an authenticated admin (the "Run pull now" button on /admin/archive),
// or Vercel's own cron invocation, authenticated via a shared CRON_SECRET per
// Vercel's cron-job auth convention (send it as `Authorization: Bearer $CRON_SECRET`
// in vercel.json / the Vercel dashboard). Set CRON_SECRET in the deployment's env
// vars for the cron path to work; without it, only admin sessions can call this.
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }
  const session = await getServerSession(authOptions);
  return Boolean(session && session.user?.role === "admin");
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPaymentCyclePull();
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run payment cycle pull" },
      { status: 500 }
    );
  }
}
