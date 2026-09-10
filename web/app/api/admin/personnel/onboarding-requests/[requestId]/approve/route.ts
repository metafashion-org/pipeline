import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { approveOnboardingRequest } from "@/lib/personnel/onboarding-sync";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";
import { z } from "zod";

// email is what a Discord-sourced request is missing: Discord never gives a bot a member's address,
// so approving one needs the address the person will sign in with.
const ApproveSchema = z.object({
  email: z.email().optional(),
  name: z.string().trim().min(1).optional(),
  reviewNotes: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const [user, { requestId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // An approval with no body at all is the ordinary case for an email request.
  const body = await request.json().catch(() => ({}));
  const parsed = ApproveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    const result = await approveOnboardingRequest(requestId, { ...parsed.data, reviewerId: user.personnelId });
    revalidateViews(CACHE_TAGS.onboardingRequests, CACHE_TAGS.personnel);
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to approve request" },
      { status: 400 }
    );
  }
}
