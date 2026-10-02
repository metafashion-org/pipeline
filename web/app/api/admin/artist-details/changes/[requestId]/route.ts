import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canHandleArtistPayDetails } from "@/lib/auth/rbac";
import { ArtistDetailsError, ArtistDetailsNotFoundError, decideArtistDetailsChange } from "@/lib/artist-details/details-service";

export const dynamic = "force-dynamic";

const MAX_NOTE_CHARS = 2_000;
const DecisionSchema = z.object({ approve: z.boolean(), note: z.string().max(MAX_NOTE_CHARS).nullable().optional() });

/** Approves or declines an artist's change to their details. The artist is emailed either way. */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const [{ requestId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canHandleArtistPayDetails(user.caps)) return NextResponse.json({ error: "Only the people who pay artists can decide this" }, { status: 403 });
  if (!z.uuid().safeParse(requestId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = DecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Approve or decline" }, { status: 400 });
  try {
    await decideArtistDetailsChange(requestId, parsed.data.approve, parsed.data.note ?? null, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ArtistDetailsNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof ArtistDetailsError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
