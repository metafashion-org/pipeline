import { NextRequest, NextResponse } from "next/server";
import { ENV } from "@/lib/env";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { sendSignoffDigest } from "@/lib/signoff/signoff-service";

export const dynamic = "force-dynamic";

// Emails Arjun the assets newly waiting for his sign-off. Called every 2 hours from 10:00 to 20:00
// India time by .github/workflows/signoff-digest.yml, because Vercel's crons on this project run
// once a day. That workflow sends `Authorization: Bearer $CRON_SECRET`; with CRON_SECRET unset the
// scheduled path is closed. A signed-in admin can call it by hand, and ?force=1 sends even outside
// those hours.
export async function GET(request: NextRequest) {
  const isCron = Boolean(ENV.CRON_SECRET) && request.headers.get("authorization") === `Bearer ${ENV.CRON_SECRET}`;
  if (!isCron) {
    const user = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const force = request.nextUrl.searchParams.get("force") === "1";
  const listed = await sendSignoffDigest(new Date(), { force });
  return NextResponse.json({ listed });
}
