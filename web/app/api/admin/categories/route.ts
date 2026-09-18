import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { listCategories, createCategory } from "@/lib/settings/categories-service";

export const dynamic = "force-dynamic";

// Read is open to any signed-in user — the person filling out an asset's Category field needs
// the list without needing canManageSystemConfig. Only creating a new one is gated, matching
// /api/admin/brand-groups.
export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const categories = await listCategories();
  return NextResponse.json({ categories });
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "You don't have permission to manage categories" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  try {
    const category = await createCategory(body.name);
    return NextResponse.json({ category });
  } catch (error: unknown) {
    // Same 23505-detection pattern as POST /api/admin/brand-groups.
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    if (cause?.code === "23505") {
      return NextResponse.json({ error: `A category named "${body.name.trim()}" already exists` }, { status: 400 });
    }
    return NextResponse.json(
      { error: errorMessage(error, "Failed to create category") },
      { status: 400 }
    );
  }
}
