import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { AssetNotFoundError, archiveAssets } from "@/lib/assets/board-visibility";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

export const dynamic = "force-dynamic";

const MAX_AT_ONCE = 200;
const MAX_REASON_CHARS = 1_000;
const ArchiveSchema = z.object({
  items: z
    .array(z.object({ sku: z.string().trim().min(1), reason: z.string().trim().min(1).max(MAX_REASON_CHARS) }))
    .min(1)
    .max(MAX_AT_ONCE),
});

/**
 * Archives several cards at once, each with its reason: they leave the board (nothing is deleted)
 * and show on the board's Archived list with the reason, who archived them and when.
 */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) return NextResponse.json({ error: "Only the team can archive cards" }, { status: 403 });

  const parsed = ArchiveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick the cards and a reason for each" }, { status: 400 });

  try {
    const archived = await archiveAssets(parsed.data.items, user.personnelId ?? null);
    // The uploader queue is a cached view and lists ready-for-upload cards.
    revalidateViews(CACHE_TAGS.publisherQueue);
    return NextResponse.json({ archived });
  } catch (error) {
    if (error instanceof AssetNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
