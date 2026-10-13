import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner, TodaysPicksError } from "@/lib/marketing/todays-picks-service";
import { confirmSubmitted, DRAFT_FIELDS, getNomination, saveDraft, setSuggestionStatus, startRenomination, undoSubmitted } from "@/lib/marketing/nomination-service";

export const dynamic = "force-dynamic";

// Longest text any field takes; the per-field limits are checked in nomination-service.ts.
const MAX_FIELD_INPUT_CHARS = 2000;
const FieldsSchema = z.object(Object.fromEntries(DRAFT_FIELDS.map((f) => [f, z.string().max(MAX_FIELD_INPUT_CHARS).optional()])));
const SaveSchema = z.object({ sku: z.string().min(1), fields: FieldsSchema });
const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), sku: z.string().min(1), draftId: z.string().uuid(), rightsConfirmed: z.boolean(), evidence: z.string().max(500).nullable() }),
  z.object({ action: z.literal("undo"), sku: z.string().min(1), draftId: z.string().uuid(), reason: z.string().max(500) }),
  z.object({ action: z.literal("renominate"), sku: z.string().min(1), reason: z.string().max(500) }),
  z.object({ action: z.literal("suggestion"), sku: z.string().min(1), suggestionId: z.string().uuid(), status: z.enum(["used", "dismissed"]) }),
]);

async function owner() {
  const user = await getAuthedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isTodaysPicksOwner(user.email)) return { error: NextResponse.json({ error: "Today's Picks is Arjun's own workflow" }, { status: 403 }) };
  return { user };
}

function handle(error: unknown) {
  if (error instanceof TodaysPicksError) return NextResponse.json({ error: error.message }, { status: 400 });
  throw error;
}

// One SKU's nomination panel: proposals with evidence, the saved draft, problems, suggestions and history.
export async function GET(request: NextRequest) {
  const { error } = await owner();
  if (error) return error;
  const sku = request.nextUrl.searchParams.get("sku");
  if (!sku) return NextResponse.json({ error: "Give the SKU" }, { status: 400 });
  try {
    return NextResponse.json(await getNomination(sku));
  } catch (e) {
    return handle(e);
  }
}

// Saves Arjun's reviewed answers.
export async function PUT(request: NextRequest) {
  const { user, error } = await owner();
  if (error) return error;
  const body = SaveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Send the SKU and its answers" }, { status: 400 });
  try {
    const draftId = await saveDraft(body.data.sku, body.data.fields, user.personnelId ?? null);
    return NextResponse.json({ draftId });
  } catch (e) {
    return handle(e);
  }
}

// Confirm a filed nomination, undo a mistaken confirmation, open a re-nomination, or use/dismiss a suggestion.
export async function POST(request: NextRequest) {
  const { user, error } = await owner();
  if (error) return error;
  const body = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const actor = user.personnelId ?? null;
  const input = body.data;
  try {
    if (input.action === "confirm") return NextResponse.json(await confirmSubmitted(input.sku, input, actor));
    if (input.action === "undo") {
      await undoSubmitted(input.sku, input.draftId, input.reason, actor);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "renominate") return NextResponse.json({ draftId: await startRenomination(input.sku, input.reason, actor) });
    await setSuggestionStatus(input.sku, input.suggestionId, input.status);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handle(e);
  }
}
