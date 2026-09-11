import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordManagerTier } from "@/lib/auth/rbac";
import { isConfigured, getDiscordOverview } from "@/lib/discord/team-service";
import { invalidateDiscordCache } from "@/lib/discord/discord-cache";

// Client-side refetch for the tabbed Team Manager panel (the initial page
// load fetches the same data server-side directly - see
// app/admin/personnel/discord/page.tsx). Kept as a thin wrapper around
// getDiscordOverview so both call paths share one implementation.
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !isDiscordManagerTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Discord not configured on this deployment." }, { status: 500 });
  }
  // The panel's Refresh button says "Refreshed from Discord", so it has to be. The guild reads are
  // cached in process for up to a couple of minutes (see discord-cache.ts); an explicit refresh
  // drops that cache first, while an ordinary load is free to use it.
  if (new URL(request.url).searchParams.get("refresh") === "1") {
    invalidateDiscordCache();
  }

  try {
    const overview = await getDiscordOverview();
    return NextResponse.json(overview);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reach Discord" }, { status: 500 });
  }
}
