import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { updateAssetPaymentDetails, SUPPORTED_CURRENCIES } from "@/lib/curation/curation-service";
import { z } from "zod";

const UpdatePaymentDetailsSchema = z
  .object({
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    paymentReceiptUrl: z.string().min(1).optional(),
  })
  .refine((v) => v.currency !== undefined || v.paymentReceiptUrl !== undefined, {
    message: "At least one of currency or paymentReceiptUrl is required",
  });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const [user, { skuId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canMarkPaymentDone) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = UpdatePaymentDetailsSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const result = await updateAssetPaymentDetails(
      skuId,
      parseResult.data,
      user.personnelId || undefined
    );
    return NextResponse.json({ success: true, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update payment details" }, { status: 400 });
  }
}
