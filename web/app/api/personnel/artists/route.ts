import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { and, eq, sql, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Lists the artists an assigner can pick from, for the assign/reassign dialog on the Kanban board.
 * Only Active personnel carrying the `artist` role are returned, because personnel.status is what actually gates login (see lib/auth/personnel-auth.ts) - assigning work to an Inactive or Blacklisted person would email someone who can no longer sign in.
 * Output: { artists: [{ id, name, email }] }, sorted by name.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const caps = getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {});
  if (!caps.canAssignArtists) {
    return NextResponse.json({ error: "You don't have permission to assign artists" }, { status: 403 });
  }

  const artists = await db
    .select({ id: personnel.id, name: personnel.name, email: personnel.email })
    .from(personnel)
    .where(and(eq(personnel.status, "Active"), sql`${personnel.roles} && ARRAY['artist']::text[]`))
    .orderBy(asc(personnel.name));

  return NextResponse.json({ artists });
}
