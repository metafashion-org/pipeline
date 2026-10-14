import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner, TodaysPicksError } from "@/lib/marketing/todays-picks-service";
import { getOwnerDetails, listFilings, markFiled, setOwnerDetails } from "@/lib/marketing/todays-picks-filing";
import { saveDraft } from "@/lib/marketing/nomination-service";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

export const dynamic = "force-dynamic";

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("filed"), sku: z.string().min(1), by: z.string().max(60).optional(), note: z.string().max(300).nullable().optional() }),
  z.object({
    action: z.literal("edit"),
    sku: z.string().min(1),
    fields: z.object({ tags: z.string().max(200), season: z.string().max(100), extra_info: z.string().max(200), theme: z.string().max(200), audience: z.string().max(40) }).partial(),
  }),
]);
const OwnerSchema = z.object({ username: z.string().min(1).max(60), email: z.string().min(3).max(120) });

async function owner() {
  const user = await getAuthedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isTodaysPicksOwner(user.email)) return { error: NextResponse.json({ error: "Today's Picks is Arjun's own workflow" }, { status: 403 }) };
  return { user };
}

// Every live item's form answers and readiness, plus the username and email used on every filing.
export async function GET() {
  const { error } = await owner();
  if (error) return error;
  const [filings, details] = await Promise.all([listFilings(), getOwnerDetails()]);
  return NextResponse.json({ filings, owner: details });
}

// Marks an item filed (and logs it in marketing), or saves an edit to its answers.
export async function POST(request: NextRequest) {
  const { user, error } = await owner();
  if (error) return error;
  const body = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  try {
    if (body.data.action === "filed") {
      const result = await markFiled(body.data.sku, { by: body.data.by ?? "Arjun", note: body.data.note ?? null }, user.personnelId ?? null);
      // The Marketing page lists the new "Roblox Today's Picks" entry.
      revalidateViews(CACHE_TAGS.marketing);
      return NextResponse.json(result);
    }
    const current = (await listFilings()).find((f) => f.sku === body.data.sku);
    if (!current) return NextResponse.json({ error: "Not a live item" }, { status: 400 });
    await saveDraft(body.data.sku, { ...current.fields, final_name: current.name ?? "", ...body.data.fields }, user.personnelId ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof TodaysPicksError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

// Changes the username and email used on every filing.
export async function PUT(request: NextRequest) {
  const { user, error } = await owner();
  if (error) return error;
  const body = OwnerSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Give a username and email" }, { status: 400 });
  try {
    return NextResponse.json(await setOwnerDetails(body.data, user.personnelId ?? null));
  } catch (e) {
    if (e instanceof TodaysPicksError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
