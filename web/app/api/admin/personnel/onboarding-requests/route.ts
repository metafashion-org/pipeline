import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { listOnboardingRequests, ONBOARDING_STATUSES, type OnboardingStatus } from "@/lib/personnel/onboarding-sync";

/**
 * The manual-review list: onboarding requests from every route, in one place.
 *
 * Input: an optional `status` query parameter, repeatable, defaulting to pending only. Output: { requests }.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const requested = request.nextUrl.searchParams.getAll("status");
  const statuses = requested.filter((s): s is OnboardingStatus =>
    (ONBOARDING_STATUSES as readonly string[]).includes(s)
  );

  return NextResponse.json({ requests: await listOnboardingRequests(statuses.length > 0 ? statuses : undefined) });
}
