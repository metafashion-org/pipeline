import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { uploadPaymentSummaryFile, isConfigured } from "@/lib/assets/drive-upload";
import { attachPaymentSummaryForArtist } from "@/lib/payments/payment-batch-service";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Same ceiling reference-upload/route.ts uses — a bank payout PDF is small, this is just an
// earlier, friendlier error than Vercel's own request-body limit.
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Uploads a payment summary PDF into the artist's Drive payments folder, then moves every asset
 * currently marked_for_payment for them to payment_done in one go. This is the single action that
 * replaced the old per-asset "paste a receipt URL, then separately drag the card" flow.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canMarkPaymentDone) {
    return NextResponse.json({ error: "You don't have permission to process payments" }, { status: 403 });
  }

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Drive upload isn't set up yet on this deployment — payment summaries can't be attached until it is." },
      { status: 503 }
    );
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const artistId = formData.get("artistId");
  const file = formData.get("file");

  if (typeof artistId !== "string" || !artistId.trim()) {
    return NextResponse.json({ error: "Missing artistId" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File is too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)}MB)` }, { status: 400 });
  }
  // A payment summary is specifically the bank's payout confirmation — keeping this to PDF only
  // (rather than accepting anything, like the reference-image upload does) keeps every artist's
  // payments folder holding the same kind of document.
  const looksLikePdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!looksLikePdf) {
    return NextResponse.json({ error: "Payment summaries must be a PDF" }, { status: 400 });
  }

  const artistRecord = await db.select({ name: personnel.name }).from(personnel).where(eq(personnel.id, artistId)).limit(1);
  if (artistRecord.length === 0) {
    return NextResponse.json({ error: "Artist not found" }, { status: 404 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadPaymentSummaryFile(
      artistRecord[0].name,
      file.name || "payment-summary.pdf",
      file.type || "application/pdf",
      bytes
    );

    const result = await attachPaymentSummaryForArtist({
      artistId,
      receiptUrl: uploaded.url,
      receiptFileName: file.name || "payment-summary.pdf",
      actor: { roles: user.roles, personnelId: user.personnelId },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error("Payment summary attach failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to attach payment summary" },
      { status: 500 }
    );
  }
}
