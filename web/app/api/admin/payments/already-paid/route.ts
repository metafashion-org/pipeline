import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { AlreadyPaidError, markAssetPaidOutside } from "@/lib/payments/payment-batch-service";
import { TransitionRefusedError } from "@/lib/kanban/transition-errors";

export const dynamic = "force-dynamic";

const AlreadyPaidSchema = z.object({ sku: z.string().min(1), note: z.string() });

// Records a card in Marked for Payment as already paid outside the Kanban. Same right as attaching
// a payment summary: canMarkPaymentDone.
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canMarkPaymentDone) return NextResponse.json({ error: "You don't have permission to process payments" }, { status: 403 });
  const parsed = AlreadyPaidSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send the SKU and a note" }, { status: 400 });
  try {
    await markAssetPaidOutside(parsed.data.sku, parsed.data.note, { roles: user.roles, personnelId: user.personnelId });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AlreadyPaidError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof TransitionRefusedError) return NextResponse.json({ error: error.reason }, { status: error.httpStatus });
    throw error;
  }
}
