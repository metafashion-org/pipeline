import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { PriorityError, PriorityNotFoundError, setCardPriority } from "@/lib/assets/priority-service";

export const dynamic = "force-dynamic";

const PrioritySchema = z.object({ priority: z.boolean(), note: z.string().nullish() });

// Marks a card priority ({ priority: true, note? }) or clears it. The team marks any card; an
// artist marks their own. The board isn't a cached view, so nothing is revalidated.
export async function POST(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = PrioritySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { priority: true } or { priority: false }" }, { status: 400 });
  try {
    const messaged = await setCardPriority(skuId, parsed.data, { personnelId: user.personnelId ?? null, isTeam: user.caps.canAssignArtists });
    return NextResponse.json({ success: true, messaged });
  } catch (error) {
    if (error instanceof PriorityNotFoundError) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    if (error instanceof PriorityError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
