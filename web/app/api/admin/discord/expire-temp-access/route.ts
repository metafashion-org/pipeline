import { NextRequest, NextResponse } from "next/server";
import { isConfigured, expireTempAccessGrants } from "@/lib/discord/team-service";

// Hit by an hourly VM crontab entry (temp access is day-granular, hourly is
// more than tight enough) — see scripts/discord-temp-access-cron.sh.
//
// Catalog Intel's own equivalent route relies on the whole app already
// sitting behind a shared Basic Auth wall (APP_PASSWORD) for this — but
// kanban.metafashion.in has NO network-level auth at all (confirmed
// directly: the site is reachable with zero credentials), unlike Catalog
// Intel. Copying that route's "no auth needed, the site already gates it"
// assumption here would have shipped a real unauthenticated write endpoint
// reachable by anyone who found the URL. Gated on a shared secret instead
// (DISCORD_CRON_SECRET) - fails closed if the env var isn't set at all.
export async function POST(request: NextRequest) {
  const expectedSecret = process.env.DISCORD_CRON_SECRET;
  const providedSecret = request.headers.get("x-cron-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isConfigured()) {
    return NextResponse.json({ ok: true, expired: 0, note: "not configured" });
  }

  try {
    const result = await expireTempAccessGrants();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to expire temp access grants" }, { status: 500 });
  }
}
