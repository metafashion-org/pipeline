import { NextRequest, NextResponse } from "next/server";
import { ENV } from "@/lib/env";
import { getDailySettings, runDailyCheck, sendMarketingSummary } from "@/lib/marketing/todays-picks-daily";
import { runNaming } from "@/lib/naming/naming-service";
import { runVariantNaming } from "@/lib/naming/variant-naming";

export const dynamic = "force-dynamic";
// The check asks Roblox about every live listing at one request per second: about 75 seconds today.
export const maxDuration = 300;

// Today's Picks daily run (web/vercel.json: 13:30 UTC, 19:00 in India): AI naming, then the Roblox
// check, then the marketing email, so the email reports fresh data. Each part does nothing while switched off on the Today's
// Picks page, and each runs at most once a day. Only Vercel's cron, with CRON_SECRET, gets in.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!ENV.CRON_SECRET || authHeader !== `Bearer ${ENV.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  // Naming first, so the evening email can list items waiting for a name decision.
  const naming = (await getDailySettings()).namingEnabled
    ? {
        base: await runNaming().catch((error) => ({ failed: true, reason: error instanceof Error ? error.message : "naming failed" })),
        variants: await runVariantNaming().catch((error) => ({ failed: true, reason: error instanceof Error ? error.message : "variant naming failed" })),
      }
    : { ran: false, reason: "daily naming is off" };
  const check = await runDailyCheck(now).catch((error) => ({ ran: false, reason: error instanceof Error ? error.message : "check failed" }));
  const email = await sendMarketingSummary(now).catch((error) => ({ sent: false, reason: error instanceof Error ? error.message : "email failed" }));
  return NextResponse.json({ naming, check, email });
}
