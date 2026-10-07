import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { canAddAssets } from "@/lib/auth/rbac";
import { getKanbanBoardData } from "@/lib/kanban/kanban-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { nextSequentialSku } from "@/lib/assets/sku";
import { toFileStoreEntries } from "@/lib/assets/file-store";
import { recordSignoffRequest } from "@/lib/signoff/signoff-service";
import { cleanBriefFields } from "@/lib/assets/asset-update";
import { linkArtifactToSku } from "@/lib/knowledge/artifact-links-service";

const MAX_LINKED_ARTIFACTS = 20;
import { SIGNOFF_STATUS, signsOff } from "@/lib/signoff/signoff-rules";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateAssetSchema = z.object({
  sku: z.string().trim().min(1).optional(),
  itemName: z.string().trim().min(1),
  category: z.string().trim().min(1).optional(),
  deadline: z.string().trim().min(1).optional(),
  plannedUploadDate: z.string().trim().min(1).optional(),
  feeAmount: z.string().trim().min(1).optional(),
  currency: z.string().trim().min(1).optional(),
  brandGroupId: z.string().trim().min(1).optional(),
  // Free text holding one or more links, the same shape the reference columns already hold in the database.
  referenceImages: z.string().optional(),
  recolorReferenceImages: z.string().optional(),
  // The brief fields from Settings > Curation fields, keyed by field key.
  briefFields: z.record(z.string().max(100), z.string().max(5_000)).optional(),
  // Registry artifacts (insights, trend briefs, moodboards) this asset comes from.
  artifactIds: z.array(z.uuid()).max(MAX_LINKED_ARTIFACTS).optional(),
});


export async function GET() {
  try {
    const user = await getAuthedUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Who sees the whole board is exactly the canViewAllAssets capability, which already
    // accounts for per-person overrides. Deriving it from session.user.role instead meant
    // payment_admin — who does hold canViewAllAssets — arrived here as "artist" and got a
    // board filtered to their own email, which is empty.
    const artistFilterEmail = user.caps.canViewAllAssets ? undefined : user.email;

    // Assets waiting for sign-off aren't on the board; they're on the Sign-off page.
    const { columns, rules } = await getKanbanBoardData(artistFilterEmail);

    return NextResponse.json({
      data: columns,
      rules,
      roles: user.roles,
    });
  } catch (error: unknown) {
    console.error("Error fetching kanban board data:", error);
    return NextResponse.json(
      { error: errorMessage(error, "Failed to fetch kanban board data") },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAddAssets(user.caps)) {
    return NextResponse.json({ error: "You don't have permission to create assets" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = CreateAssetSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const { itemName, category, feeAmount, currency, brandGroupId } = parseResult.data;
  // Continues the MF-<year>-<nnnn> sequence the rest of the table already uses. A concurrent create could pick the same number, which the unique constraint on assets.sku rejects and the 23505 branch below reports.
  let sku = parseResult.data.sku;
  if (!sku) {
    const existing = await db.select({ sku: assets.sku }).from(assets);
    sku = nextSequentialSku(existing.map((a) => a.sku), new Date().getFullYear());
  }

  let deadline: Date | null = null;
  if (parseResult.data.deadline) {
    deadline = new Date(parseResult.data.deadline);
    if (isNaN(deadline.getTime())) {
      return NextResponse.json({ error: "Invalid deadline" }, { status: 400 });
    }
  }

  let plannedUploadDate: Date | null = null;
  if (parseResult.data.plannedUploadDate) {
    plannedUploadDate = new Date(parseResult.data.plannedUploadDate);
    if (isNaN(plannedUploadDate.getTime())) {
      return NextResponse.json({ error: "Invalid planned upload date" }, { status: 400 });
    }
  }

  // Arjun signs off everything someone else adds before it goes on the board; his own adds go
  // straight to Unassigned (lib/signoff/signoff-rules.ts).
  const needsSignoff = !signsOff(user.roles);
  try {
    const [created] = await db
      .insert(assets)
      .values({
        sku,
        itemName,
        category: category || null,
        currentStatus: needsSignoff ? SIGNOFF_STATUS : "unassigned",
        deadline,
        plannedUploadDate,
        feeAmount: feeAmount || null,
        currency: currency || "INR",
        brandGroupId: brandGroupId || null,
        referenceImages: toFileStoreEntries(parseResult.data.referenceImages),
        recolorReferenceImages: toFileStoreEntries(parseResult.data.recolorReferenceImages),
        briefFields: cleanBriefFields(parseResult.data.briefFields),
      })
      .returning();

    await db.insert(auditLog).values({
      action: "createAsset",
      entityType: "asset",
      entityId: created.id,
      actorId: user.personnelId || null,
      payload: { sku, itemName, category: category || null, needsSignoff },
    });
    if (needsSignoff) await recordSignoffRequest(created.id, user.personnelId ?? null);
    for (const artifactId of parseResult.data.artifactIds ?? []) {
      await linkArtifactToSku(artifactId, created.id, user.personnelId ?? undefined);
    }

    return NextResponse.json({ success: true, asset: created, needsSignoff });
  } catch (error: unknown) {
    console.error("Error creating asset:", error);
    // postgres-js surfaces the real Postgres error as `.cause` on the drizzle-wrapped error;
    // code 23505 is unique_violation, which here means the given SKU is already in use.
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    if (cause?.code === "23505") {
      return NextResponse.json({ error: `SKU '${sku}' is already in use` }, { status: 400 });
    }
    const message = errorMessage(error, "Failed to create asset");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
