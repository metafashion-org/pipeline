import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { CURATION_REVIEW_MODES, getCurationReviewMode, setCurationReviewMode } from "@/lib/settings/app-settings";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

export const dynamic = "force-dynamic";

const ModeSchema = z.object({ mode: z.enum(CURATION_REVIEW_MODES) });

/** The curation review trial's current mode: off, admins or everyone. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ mode: await getCurationReviewMode() });
}

/** Sets the mode. Switching it off moves every card waiting in Curated to Unassigned. */
export async function PUT(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = ModeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Mode must be off, admins or everyone" }, { status: 400 });

  try {
    const result = await setCurationReviewMode(parsed.data.mode, user.personnelId);
    // Turning it on can add the "Pinterest board" curation field, which the brief-field lists cache.
    revalidateViews(CACHE_TAGS.curationFields);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Setting the curation review mode failed:", error);
    return NextResponse.json({ error: errorMessage(error, "Couldn't change the setting") }, { status: 500 });
  }
}
