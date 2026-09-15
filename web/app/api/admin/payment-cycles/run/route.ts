import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { runPaymentCyclePull } from "@/lib/payments/payment-cycle-service";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";

// The payment_cycles snapshot this produces is no longer read anywhere — payments moved to a
// live, per-artist view at /admin/payments (see lib/payments/payment-batch-service.ts) instead of
// a 15th/last-day-of-month pull, and vercel.json's cron entry calling this route was removed
// along with the "Run pull now" button that used to POST here manually. Left in place rather than
// deleted: it's harmless, still properly gated, and the historical payment_cycles/
// payment_cycle_items rows it already wrote stay queryable if anyone ever wants that record.
//
// Two ways in, unchanged: an authenticated admin, or Vercel's own cron invocation (were it still
// scheduled), authenticated via a shared CRON_SECRET per Vercel's cron-job auth convention (send
// it as `Authorization: Bearer $CRON_SECRET`). Set CRON_SECRET in the deployment's env vars for
// the cron path to work; without it, only admin sessions can call this.
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

// Shared by both methods — GET for a cron invocation, POST for a direct manual call.
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
