import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { rejectOnboardingRequest } from "@/lib/personnel/onboarding-sync";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";
import { z } from "zod";

const RejectSchema = z.object({ reviewNotes: z.string().trim().min(1).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const [user, { requestId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const parsed = RejectSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  try {
    await rejectOnboardingRequest(requestId, user.personnelId, parsed.data.reviewNotes);
    revalidateViews(CACHE_TAGS.onboardingRequests);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reject request" },
      { status: 400 }
    );
  }
}
