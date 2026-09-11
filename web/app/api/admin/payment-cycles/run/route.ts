import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { runPaymentCyclePull } from "@/lib/payments/payment-cycle-service";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";

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
  if (!session) return false;
  const caps = getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {});
  // Running a payment cycle pull is a money action, so it stays on the same capability that gates
  // marking payments done rather than on the deprecated collapsed session.user.role.
  return caps.canMarkPaymentDone;
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
      { error: error instanceof Error ? error.message : "Failed to run payment cycle pull" },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;
