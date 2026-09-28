import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getCurationReview, sendCurationBack, CurationReviewError } from "@/lib/curation/curation-review";

export const dynamic = "force-dynamic";

// Long enough for a few sentences of feedback, short enough to read in an email quote.
const MAX_NOTE_CHARS = 2000;

const SendBackSchema = z.object({
  note: z.string().trim().min(1, "Write a note so the curator knows what to change").max(MAX_NOTE_CHARS),
});

/** What the curator wrote for the idea behind this asset. Shown in the asset drawer while it waits in Curated. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canViewAllAssets && !user.caps.canAccessCuratorTools) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const review = await getCurationReview(skuId);
  return NextResponse.json({ review });
}

/** Sends the idea back to its curator with a note. The card stays in Curated. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) {
    return NextResponse.json({ error: "Only the team can send an idea back" }, { status: 403 });
  }

  const parsed = SendBackSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid note" }, { status: 400 });
  }

  try {
    const result = await sendCurationBack(skuId, parsed.data.note, user.personnelId);
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof CurationReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    console.error("Sending an idea back failed:", error);
    return NextResponse.json({ error: errorMessage(error, "Couldn't send the idea back") }, { status: 500 });
  }
}
