import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { listBrandGroups, createBrandGroup } from "@/lib/settings/brand-groups-service";

export const dynamic = "force-dynamic";

// Read is open to any signed-in user — the uploader specifically needs to see which groups
// exist (and which one an asset is set to) without needing canManageSystemConfig. Only creating
// a new group is gated, matching the rest of /admin/settings.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const brandGroups = await listBrandGroups();
  return NextResponse.json({ brandGroups });
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "You don't have permission to manage brand/upload groups" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  try {
    const group = await createBrandGroup(body.name, body.robloxGroupUrl);
    return NextResponse.json({ brandGroup: group });
  } catch (error: unknown) {
    // Same 23505-detection pattern as POST /api/assets — postgres-js surfaces the real Postgres
    // error as `.cause` on the drizzle-wrapped error.
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    if (cause?.code === "23505") {
      return NextResponse.json({ error: `A group named "${body.name.trim()}" already exists` }, { status: 400 });
    }
    return NextResponse.json(
      { error: errorMessage(error, "Failed to create brand/upload group") },
      { status: 400 }
    );
  }
}
