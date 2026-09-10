import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { syncOnboardingRequests, listOnboardingRequests } from "@/lib/personnel/onboarding-sync";
import { invalidateDiscordCache } from "@/lib/discord/discord-cache";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

/**
 * Pulls onboarding requests in from both routes and returns the refreshed review list.
 *
 * Input: nothing. Output: { result, requests } — what the sync found, and the pending list as it now stands. A sync never approves anyone; every request it brings in arrives as pending.
 *
 * An explicit sync drops the cached Discord reads first, because this is the button someone
 * presses when they know a new person just joined the server.
 */
export async function POST() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  invalidateDiscordCache();

  try {
    const result = await syncOnboardingRequests();
    revalidateViews(CACHE_TAGS.onboardingRequests);
    return NextResponse.json({ result, requests: await listOnboardingRequests() });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync onboarding requests" },
      { status: 500 }
    );
  }
}
