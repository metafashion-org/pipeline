import { db } from "@/lib/db/client";
import { paymentCycles } from "@/lib/db/schema/payment_cycles";
import { paymentCycleItems } from "@/lib/db/schema/payment_cycle_items";
import { assets } from "@/lib/db/schema/assets";
import { eq, inArray } from "drizzle-orm";

// Same statuses app/admin/archive/page.tsx's Pending Payments section reads —
// client pays out on the 15th and the last day of the month.
export const PENDING_PAYMENT_STATUSES = ["marked_for_payment", "uploaded_to_roblox"];

// True if `date` is a payout day: the 15th of the month, or the month's last calendar day (28-31, computed from the actual month/year rather than hardcoded).
export function isPayoutDay(date: Date): boolean {
  const day = date.getDate();
  const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return day === 15 || day === lastDayOfMonth;
}

// Formats a Date as a local YYYY-MM-DD string, matching the `date`-typed payment_cycles.cycle_date column so "today" is compared/stored consistently regardless of time-of-day.
function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type PaymentCyclePullResult =
  | { cycleId: string; itemCount: number }
  | { skipped: true; reason: string };

// Pulls today's eligible pending-payment assets into a new payment_cycles row, with one payment_cycle_items snapshot row (sku/fee/currency at pull time) per eligible asset. No-ops on a non-payout day or if a cycle already exists for today, so it's safe to call repeatedly (e.g. from a daily cron plus manual admin retries). Input: an optional date to pull for, defaulting to the current date (callers pass one to test a specific payout day on demand instead of waiting for a real one). Output: the created cycle's id and item count, or a skip reason.
export async function runPaymentCyclePull(today: Date = new Date()): Promise<PaymentCyclePullResult> {
  if (!isPayoutDay(today)) {
    return { skipped: true, reason: "Not a payout day (only the 15th and the last day of the month run a pull)" };
  }

  const todayDateOnly = toDateOnly(today);
  const existing = await db
    .select({ id: paymentCycles.id })
    .from(paymentCycles)
    .where(eq(paymentCycles.cycleDate, todayDateOnly))
    .limit(1);
  if (existing.length > 0) {
    return { skipped: true, reason: `A payment cycle for ${todayDateOnly} already exists` };
  }

  const eligibleAssets = await db
    .select({
      id: assets.id,
      sku: assets.sku,
      feeAmount: assets.feeAmount,
      currency: assets.currency,
    })
    .from(assets)
    .where(inArray(assets.currentStatus, PENDING_PAYMENT_STATUSES));

  const [inserted] = await db
    .insert(paymentCycles)
    .values({ cycleDate: todayDateOnly })
    .onConflictDoNothing({ target: paymentCycles.cycleDate })
    .returning();

  if (!inserted) {
    // Lost the race to a concurrent call (e.g. cron + manual retry) that inserted first; skip cleanly instead of duplicating.
    return { skipped: true, reason: `A payment cycle for ${todayDateOnly} already exists` };
  }
  const cycle = inserted;

  if (eligibleAssets.length > 0) {
    await db.insert(paymentCycleItems).values(
      eligibleAssets.map((a) => ({
        cycleId: cycle.id,
        assetId: a.id,
        sku: a.sku,
        feeAmount: a.feeAmount,
        currency: a.currency,
      }))
    );
  }

  return { cycleId: cycle.id, itemCount: eligibleAssets.length };
}
