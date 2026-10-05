import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { sendSignoffDigest } from "@/lib/signoff/signoff-service";

export const dynamic = "force-dynamic";

// Emails Arjun the assets newly waiting for his sign-off. Called every 2 hours from 10:00 to 20:00
// India time by .github/workflows/signoff-digest.yml, because Vercel's Hobby plan only runs crons
// once a day.
//
// The scheduled call needs no sign-in or secret, by Arjun's choice, so there's nothing to keep in
// sync between Vercel and GitHub. That's safe because an anonymous call can only do what the
// schedule does: send the one fixed address the summary of assets newly waiting, only within those
// hours, and never the same asset twice. It returns nothing about them. Sending outside the hours
// (?force=1) needs a signed-in admin.
export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force") === "1";
  if (force) {
    const user = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ listed: await sendSignoffDigest(new Date(), { force: true }) });
  }
  await sendSignoffDigest(new Date());
  return NextResponse.json({ ok: true });
}
