import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getLastTaskSheetSync, getTaskSheetConfig, setUpTaskSheet } from "@/lib/team-tasks/sheet-intake";
import { TeamTaskInputError } from "@/lib/team-tasks/team-tasks-service";

export const dynamic = "force-dynamic";

const SetUpSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.email() });

/** The task sheet Instinct writes rows in, and when it was last read. Admins only. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [config, lastSync] = await Promise.all([getTaskSheetConfig(), getLastTaskSheetSync()]);
  return NextResponse.json({ sheet: config ? { url: config.url, email: config.email } : null, lastSync });
}

/** Makes the task sheet in the shared drive and shares it with the tool's email as an editor. */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = SetUpSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the tool a name and an email" }, { status: 400 });
  try {
    const config = await setUpTaskSheet(parsed.data, user.personnelId ?? null);
    return NextResponse.json({ sheet: { url: config.url, email: config.email } });
  } catch (error) {
    if (error instanceof TeamTaskInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    // Google's own message, e.g. when the shared drive doesn't allow sharing outside the company.
    return NextResponse.json({ error: `Google refused: ${error instanceof Error ? error.message : "unknown error"}` }, { status: 502 });
  }
}
