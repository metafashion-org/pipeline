import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { ArtistDetailsError, getOwnArtistDetails, saveFirstArtistDetails } from "@/lib/artist-details/details-service";
import { ArtistDetailsSchema } from "./details-schema";

export const dynamic = "force-dynamic";

/** The caller's own My details: everything they saved, their documents, and any change waiting. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.personnelId) return NextResponse.json({ error: "Your account isn't set up yet" }, { status: 403 });
  return NextResponse.json(await getOwnArtistDetails(user.personnelId));
}

/** Saves the caller's details the first time. Later changes go to /api/artist/details/change. */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.personnelId) return NextResponse.json({ error: "Your account isn't set up yet" }, { status: 403 });

  const parsed = ArtistDetailsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Fill in the form" }, { status: 400 });
  try {
    await saveFirstArtistDetails(user.personnelId, parsed.data, user.personnelId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ArtistDetailsError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
