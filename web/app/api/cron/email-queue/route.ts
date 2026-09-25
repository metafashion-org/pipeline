import { NextRequest, NextResponse } from "next/server";
import { ENV } from "@/lib/env";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { sendDueEmails } from "@/lib/email/queue-worker";

export const dynamic = "force-dynamic";

// Retries queued emails that didn't go out when they were queued (Resend down, or a failure that
// scheduled a retry). Every email is also attempted immediately when it is queued, so this is the
// safety net, not the main path.
//
// Two ways in: Vercel's cron, which sends `Authorization: Bearer $CRON_SECRET`, or a signed-in
// person who can assign artists. With CRON_SECRET unset the cron path is closed.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const isCron = Boolean(ENV.CRON_SECRET) && authHeader === `Bearer ${ENV.CRON_SECRET}`;
  if (!isCron) {
    const user = await getAuthedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.caps.canAssignArtists) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const results = await sendDueEmails();
  return NextResponse.json({ processed: results.length, results });
}
