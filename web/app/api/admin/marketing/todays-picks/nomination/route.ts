import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { isTodaysPicksOwner, TodaysPicksError } from "@/lib/marketing/todays-picks-service";
import { NameEvidenceError, retireEvidence } from "@/lib/marketing/name-evidence";
import { APPROVABLE_FIELDS, approveField, confirmSubmitted, DRAFT_FIELDS, getNomination, saveDraft, setSuggestionStatus, undoSubmitted } from "@/lib/marketing/nomination-service";

export const dynamic = "force-dynamic";

// Longest text any field takes; the per-field limits are checked in nomination-service.ts.
const MAX_FIELD_INPUT_CHARS = 2000;
const FieldsSchema = z.object(Object.fromEntries(DRAFT_FIELDS.map((f) => [f, z.string().max(MAX_FIELD_INPUT_CHARS).optional()])));
const SaveSchema = z.object({ sku: z.string().min(1), fields: FieldsSchema });
const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), sku: z.string().min(1), draftId: z.string().uuid(), version: z.string().min(1), rightsConfirmed: z.boolean(), evidence: z.string().max(500).nullable() }),
  z.object({ action: z.literal("undo"), sku: z.string().min(1), draftId: z.string().uuid(), reason: z.string().max(500) }),
  z.object({ action: z.literal("approve"), sku: z.string().min(1), draftId: z.string().uuid(), version: z.string().min(1), field: z.enum(APPROVABLE_FIELDS), reviewRef: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal("retire_evidence"), sku: z.string().min(1), evidenceId: z.string().uuid(), reason: z.string().max(500) }),
  z.object({ action: z.literal("suggestion"), sku: z.string().min(1), suggestionId: z.string().uuid(), status: z.enum(["used", "dismissed"]) }),
]);

async function owner() {
  const user = await getAuthedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isTodaysPicksOwner(user.email)) return { error: NextResponse.json({ error: "Today's Picks is Arjun's own workflow" }, { status: 403 }) };
  return { user };
}

function handle(error: unknown) {
  if (error instanceof TodaysPicksError || error instanceof NameEvidenceError) return NextResponse.json({ error: error.message }, { status: 400 });
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

// Approve the name, colour links or item-page answers, retire wrong naming evidence, record Arjun's confirmation that he filed it, undo a mistaken
// confirmation, or use/dismiss a suggestion. Re-nomination is off until its policy is agreed.
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
    if (input.action === "approve") {
      await approveField(input.sku, { draftId: input.draftId, version: input.version, field: input.field, reviewRef: input.reviewRef ?? null }, actor);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "retire_evidence") {
      await retireEvidence(input.sku, input.evidenceId, input.reason, actor);
      return NextResponse.json({ ok: true });
    }
    await setSuggestionStatus(input.sku, input.suggestionId, input.status);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handle(e);
  }
}
