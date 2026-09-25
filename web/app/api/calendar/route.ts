import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getCalendarEvents } from "@/lib/calendar/calendar-service";

export const dynamic = "force-dynamic";

// The widest range one request may ask for: a month grid plus its leading and trailing week.
const MAX_RANGE_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

const RangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// The company calendar's events for a date range. Open to anyone who sees the whole board.
export async function GET(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canViewAllAssets) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = RangeSchema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to"),
  });
  if (!parsed.success) return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });

  // The range is read as India dates, where the team works: from midnight IST on `from` to midnight IST on `to`.
  const from = new Date(`${parsed.data.from}T00:00:00+05:30`);
  const to = new Date(`${parsed.data.to}T00:00:00+05:30`);
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  if (days <= 0 || days > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `Ask for 1 to ${MAX_RANGE_DAYS} days at a time` }, { status: 400 });
  }

  return NextResponse.json({ events: await getCalendarEvents(from, to) });
}
