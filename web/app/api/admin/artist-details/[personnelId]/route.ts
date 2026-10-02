import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canHandleArtistPayDetails } from "@/lib/auth/rbac";
import { ArtistDetailsNotFoundError, revealArtistDetails } from "@/lib/artist-details/details-service";

export const dynamic = "force-dynamic";

/** One artist's details in full, with any change waiting. Each call is logged in audit_log. */
export async function GET(_request: Request, { params }: { params: Promise<{ personnelId: string }> }) {
  const [{ personnelId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canHandleArtistPayDetails(user.caps)) return NextResponse.json({ error: "Only the people who pay artists can see this" }, { status: 403 });
  if (!z.uuid().safeParse(personnelId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await revealArtistDetails(personnelId, user.personnelId ?? null));
  } catch (error) {
    if (error instanceof ArtistDetailsNotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw error;
  }
}
