import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner } from "@/lib/marketing/todays-picks-service";
import { buildMarketingSummary, getDailySettings, MARKETING_EMAIL_RECIPIENTS, renderMarketingEmail, setDailySwitches } from "@/lib/marketing/todays-picks-daily";
import { teamDay } from "@/lib/team-tasks/task-rules";

export const dynamic = "force-dynamic";

const SwitchSchema = z.object({ checkEnabled: z.boolean().optional(), emailEnabled: z.boolean().optional() });

async function owner() {
  const user = await getAuthedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isTodaysPicksOwner(user.email)) return { error: NextResponse.json({ error: "Today's Picks is Arjun's own workflow" }, { status: 403 }) };
  return { user };
}

// The daily switches and last check. With ?preview=email, today's marketing email as HTML instead,
// rendered but not sent.
export async function GET(request: NextRequest) {
  const { error } = await owner();
  if (error) return error;
  if (request.nextUrl.searchParams.get("preview") === "email") {
    const { subject, html } = renderMarketingEmail(await buildMarketingSummary(teamDay(new Date())));
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Email-Subject": encodeURIComponent(subject) } });
  }
  return NextResponse.json({ ...(await getDailySettings()), recipients: MARKETING_EMAIL_RECIPIENTS });
}

// Turns the daily check or the marketing email on or off.
export async function PUT(request: NextRequest) {
  const { user, error } = await owner();
  if (error) return error;
  const body = SwitchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Say which switch to set" }, { status: 400 });
  return NextResponse.json(await setDailySwitches(body.data, user.personnelId ?? null));
}
