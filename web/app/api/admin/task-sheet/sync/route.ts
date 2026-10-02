import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { syncTaskSheet } from "@/lib/team-tasks/sheet-intake";

export const dynamic = "force-dynamic";

/** Reads the task sheet now instead of waiting for the next board load. Admins only. */
export async function POST() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await syncTaskSheet({ force: true });
  if (!result) return NextResponse.json({ error: "The task sheet isn't set up yet" }, { status: 400 });
  return NextResponse.json(result);
}
