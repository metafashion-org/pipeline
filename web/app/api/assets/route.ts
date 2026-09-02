import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { getKanbanBoardData } from "@/lib/kanban/kanban-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { nextSequentialSku } from "@/lib/assets/sku";
import { toFileStoreEntries } from "@/lib/assets/file-store";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateAssetSchema = z.object({
  sku: z.string().trim().min(1).optional(),
  itemName: z.string().trim().min(1),
  category: z.string().trim().min(1).optional(),
  deadline: z.string().trim().min(1).optional(),
  feeAmount: z.string().trim().min(1).optional(),
  currency: z.string().trim().min(1).optional(),
  // Free text holding one or more links, the same shape the reference columns already hold in the database.
  referenceImages: z.string().optional(),
  recolorReferenceImages: z.string().optional(),
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

    const { columns } = await getKanbanBoardData(artistFilterEmail);

    return NextResponse.json({
      data: columns,
      roles: user.roles,
    });
  } catch (error: unknown) {
    console.error("Error fetching kanban board data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch kanban board data" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canAssignArtists) {
    return NextResponse.json({ error: "You don't have permission to create assets" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = CreateAssetSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const { itemName, category, feeAmount, currency } = parseResult.data;
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

  try {
    const [created] = await db
      .insert(assets)
      .values({
        sku,
        itemName,
        category: category || null,
        currentStatus: "unassigned",
        deadline,
        feeAmount: feeAmount || null,
        currency: currency || "INR",
        referenceImages: toFileStoreEntries(parseResult.data.referenceImages),
        recolorReferenceImages: toFileStoreEntries(parseResult.data.recolorReferenceImages),
      })
      .returning();

    await db.insert(auditLog).values({
      action: "createAsset",
      entityType: "asset",
      entityId: created.id,
      actorId: user.personnelId || null,
      payload: { sku, itemName, category: category || null },
    });

    return NextResponse.json({ success: true, asset: created });
  } catch (error: unknown) {
    console.error("Error creating asset:", error);
    // postgres-js surfaces the real Postgres error as `.cause` on the drizzle-wrapped error;
    // code 23505 is unique_violation, which here means the given SKU is already in use.
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    if (cause?.code === "23505") {
      return NextResponse.json({ error: `SKU '${sku}' is already in use` }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to create asset";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
