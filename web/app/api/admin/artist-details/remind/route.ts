import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canHandleArtistPayDetails } from "@/lib/auth/rbac";
import { remindArtistsToAddDetails } from "@/lib/artist-details/details-service";
import { detailsReminderText } from "@/lib/artist-details/details-notifications";

export const dynamic = "force-dynamic";

const RemindSchema = z.object({ dryRun: z.boolean().default(true) });

/**
 * Messages every Active artist who hasn't saved their details, on Discord, and by email when their
 * onboarding-form documents were copied in. { dryRun: true } (the default) only lists who would be
 * messaged, with the exact Discord wording for both kinds of artist.
 */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canHandleArtistPayDetails(user.caps)) return NextResponse.json({ error: "Only the people who pay artists can send this" }, { status: 403 });

  const parsed = RemindSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const results = await remindArtistsToAddDetails(user.personnelId ?? null, { dryRun: parsed.data.dryRun });
  return NextResponse.json({
    results,
    wording: { fresh: detailsReminderText("<name>", false), prefilled: detailsReminderText("<name>", true) },
  });
}
