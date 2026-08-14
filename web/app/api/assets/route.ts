import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getKanbanBoardData } from "@/lib/kanban/kanban-service";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { generateAssetSku } from "@/lib/curation/curation-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateAssetSchema = z.object({
  sku: z.string().trim().min(1).optional(),
  itemName: z.string().trim().min(1),
  category: z.string().trim().min(1).optional(),
  deadline: z.string().trim().min(1).optional(),
  feeAmount: z.string().trim().min(1).optional(),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { user } = session;
    const isArtistOnly = user.role === "artist" && (!user.roles || !user.roles.includes("admin") && !user.roles.includes("operator"));
    const artistFilterEmail = isArtistOnly ? user.email || undefined : undefined;

    const { columns } = await getKanbanBoardData(artistFilterEmail);

    return NextResponse.json({
      data: columns,
      role: user.role || "artist",
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
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parseResult = CreateAssetSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const { itemName, category, feeAmount } = parseResult.data;
  const sku = parseResult.data.sku || generateAssetSku("ADMIN");

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
      })
      .returning();

    await db.insert(auditLog).values({
      action: "createAsset",
      entityType: "asset",
      entityId: created.id,
      actorId: session.user.personnelId || null,
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
