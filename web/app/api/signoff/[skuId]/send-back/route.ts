import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { sendBackSignoff } from "@/lib/signoff/signoff-service";
import { signoffActor, signoffErrorResponse } from "../../signoff-route-helpers";

export const dynamic = "force-dynamic";

const MAX_FEEDBACK_CHARS = 5_000;
const SendBackSchema = z.object({ feedback: z.string().trim().min(1).max(MAX_FEEDBACK_CHARS) });

/** Sends an asset back to whoever added it, with feedback. Admins only (the service checks). */
export async function POST(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = SendBackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Say what to change" }, { status: 400 });
  try {
    await sendBackSignoff(skuId, parsed.data.feedback, signoffActor(user));
    return NextResponse.json({ success: true });
  } catch (error) {
    return signoffErrorResponse(error);
  }
}
