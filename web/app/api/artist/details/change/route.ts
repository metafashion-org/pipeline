import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { ArtistDetailsError, requestArtistDetailsChange } from "@/lib/artist-details/details-service";
import { ArtistDetailsSchema } from "../details-schema";

export const dynamic = "force-dynamic";

const MAX_REASON_CHARS = 2_000;
const ChangeSchema = z.object({
  details: ArtistDetailsSchema,
  reason: z.string().trim().min(1).max(MAX_REASON_CHARS),
});

/** Asks to change saved details, with a reason. The old details stay in use until it's approved. */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.personnelId) return NextResponse.json({ error: "Your account isn't set up yet" }, { status: 403 });

  const parsed = ChangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say why the details are changing" }, { status: 400 });
  try {
    await requestArtistDetailsChange(user.personnelId, parsed.data.details, parsed.data.reason, user.personnelId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ArtistDetailsError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
