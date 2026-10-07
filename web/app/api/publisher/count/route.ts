import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { countReadyForUpload } from "@/lib/publisher/publisher-service";

export const dynamic = "force-dynamic";

// The sidebar badge on the Uploader Queue: how many assets wait for their Roblox links.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canPublishToRoblox) return NextResponse.json({ error: "Only the uploaders see this" }, { status: 403 });
  return NextResponse.json({ count: await countReadyForUpload() });
}
