import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { approveSignoffs } from "@/lib/signoff/signoff-service";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";
import { signoffActor, signoffErrorResponse } from "../signoff-route-helpers";

export const dynamic = "force-dynamic";

const MAX_AT_ONCE = 100;
const ApproveSchema = z.object({ skus: z.array(z.string().min(1)).min(1).max(MAX_AT_ONCE) });

/** Signs one or more assets off onto the board. Admins only (the service checks). */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = ApproveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick the assets to approve" }, { status: 400 });
  try {
    const approved = await approveSignoffs(parsed.data.skus, signoffActor(user));
    // The assets are now on the board, which the dashboard and queues read from.
    revalidateViews(CACHE_TAGS.publisherQueue, CACHE_TAGS.marketing);
    return NextResponse.json({ approved });
  } catch (error) {
    return signoffErrorResponse(error);
  }
}
