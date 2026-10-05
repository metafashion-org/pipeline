import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { dropSignoff } from "@/lib/signoff/signoff-service";
import { signoffActor, signoffErrorResponse } from "../../signoff-route-helpers";

export const dynamic = "force-dynamic";

const MAX_REASON_CHARS = 5_000;
const DropSchema = z.object({ reason: z.string().max(MAX_REASON_CHARS).nullable().optional() });

/** Drops an asset: hidden from the board, not deleted. Admins only (the service checks). */
export async function POST(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = DropSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    await dropSignoff(skuId, parsed.data.reason ?? null, signoffActor(user));
    return NextResponse.json({ success: true });
  } catch (error) {
    return signoffErrorResponse(error);
  }
}
