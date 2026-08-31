import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { isDiscordManagerTier } from "@/lib/auth/rbac";
import { isConfigured, getDiscordOverview } from "@/lib/discord/team-service";

// Client-side refetch for the tabbed Team Manager panel (the initial page
// load fetches the same data server-side directly - see
// app/admin/personnel/discord/page.tsx). Kept as a thin wrapper around
// getDiscordOverview so both call paths share one implementation.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !isDiscordManagerTier(session.user.roles || [])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "Discord not configured on this deployment." }, { status: 500 });
  }
  try {
    const overview = await getDiscordOverview();
    return NextResponse.json(overview);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reach Discord" }, { status: 500 });
  }
}
