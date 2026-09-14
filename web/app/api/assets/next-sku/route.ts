import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { nextSequentialSku } from "@/lib/assets/sku";

export const dynamic = "force-dynamic";

// A preview for the New Asset dialog only — the real SKU is computed fresh again at creation
// time (POST /api/assets), which is what actually has to stay race-safe: two people opening this
// dialog at the same moment could otherwise both be shown the same "next" SKU, and only one of
// them would get it at submit time (the other 23505s and has to retry). Showing it here is purely
// so the field isn't a blank, editable-looking box when it never actually accepts edits.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await db.select({ sku: assets.sku }).from(assets);
  const sku = nextSequentialSku(existing.map((a) => a.sku), new Date().getFullYear());
  return NextResponse.json({ sku });
}
