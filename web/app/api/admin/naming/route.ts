import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner } from "@/lib/marketing/todays-picks-service";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";
import { approveName, getGuidelines, listNaming, MAX_ITEMS_PER_RUN, NAMING_MODEL, NamingError, runNaming, setGuidelines } from "@/lib/naming/naming-service";
import { approveVariants, listVariantNaming, runVariantNaming } from "@/lib/naming/variant-naming";

export const dynamic = "force-dynamic";
// A run sends up to MAX_ITEMS_PER_RUN items to Claude in groups; each call takes up to a minute.
export const maxDuration = 300;

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), skus: z.array(z.string().min(1)).max(MAX_ITEMS_PER_RUN).optional() }),
  z.object({ action: z.literal("run_variants"), skus: z.array(z.string().min(1)).max(MAX_ITEMS_PER_RUN).optional() }),
  z.object({
    action: z.literal("approve_variants"),
    sku: z.string().min(1),
    proposalId: z.string().uuid(),
    names: z.array(z.object({ listingId: z.string().uuid().optional(), colour: z.string().min(1).max(40), name: z.string().min(1).max(200) })).min(1).max(30),
  }),
  z.object({ action: z.literal("approve"), sku: z.string().min(1), proposalId: z.string().uuid().nullable(), name: z.string().min(1).max(200) }),
]);
const GuidelinesSchema = z.object({ text: z.string().min(1).max(8000) });

// Naming is Arjun's approval step, so it uses the same owner-only rule as Today's Picks.
async function owner() {
  const user = await getAuthedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isTodaysPicksOwner(user.email)) return { error: NextResponse.json({ error: "Naming approval is Arjun's" }, { status: 403 }) };
  return { user };
}

// Items waiting for a name with their latest suggestions, plus the guidelines in use.
export async function GET() {
  const { error } = await owner();
  if (error) return error;
  const [items, variants, guidelines] = await Promise.all([listNaming(), listVariantNaming(), getGuidelines()]);
  return NextResponse.json({ items, variants, guidelines, model: NAMING_MODEL, keyConfigured: !!process.env.ANTHROPIC_API_KEY });
}

// Runs base or variant naming now, or approves a base name or a set of variant names.
export async function POST(request: NextRequest) {
  const { user, error } = await owner();
  if (error) return error;
  const body = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  try {
    if (body.data.action === "run") return NextResponse.json(await runNaming({ onlySkus: body.data.skus, actorId: user.personnelId ?? null }));
    if (body.data.action === "run_variants") return NextResponse.json(await runVariantNaming({ onlySkus: body.data.skus, actorId: user.personnelId ?? null }));
    if (body.data.action === "approve_variants") {
      await approveVariants(body.data.sku, { proposalId: body.data.proposalId, names: body.data.names }, user.personnelId ?? null);
      // The Uploader Queue shows approved colourway names.
      revalidateViews(CACHE_TAGS.publisherQueue);
      return NextResponse.json({ ok: true });
    }
    await approveName(body.data.sku, { proposalId: body.data.proposalId, name: body.data.name }, user.personnelId ?? null);
    // The Uploader Queue shows the approved name.
    revalidateViews(CACHE_TAGS.publisherQueue);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NamingError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

// Saves Arjun's naming guidelines.
export async function PUT(request: NextRequest) {
  const { user, error } = await owner();
  if (error) return error;
  const body = GuidelinesSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Guidelines are 1-8000 characters" }, { status: 400 });
  try {
    await setGuidelines(body.data.text, user.personnelId ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NamingError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
