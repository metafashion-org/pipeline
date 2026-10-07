import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { endTrialRun, startTrialRun, trialProgress } from "@/lib/trial/trial-run";

export const dynamic = "force-dynamic";

const TrialActionSchema = z.object({ action: z.enum(["start", "end"]) });

/** Where the trial run is: the test asset's SKU and status, and the statuses it has reached. For the team. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ trial: await trialProgress() });
}

/** Starts a trial run (a test asset and the bot artist) or ends it (hides the asset, switches the bot off). */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = TrialActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say start or end" }, { status: 400 });
  if (parsed.data.action === "start") return NextResponse.json(await startTrialRun(user.personnelId ?? null));
  await endTrialRun(user.personnelId ?? null);
  return NextResponse.json({ success: true });
}
