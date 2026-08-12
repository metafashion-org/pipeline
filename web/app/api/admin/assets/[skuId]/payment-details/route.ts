import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
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
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { skuId } = await params;
  const body = await request.json();
  const parseResult = UpdatePaymentDetailsSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const result = await updateAssetPaymentDetails(
      skuId,
      parseResult.data,
      session.user.personnelId || undefined
    );
    return NextResponse.json({ success: true, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update payment details" }, { status: 400 });
  }
}
