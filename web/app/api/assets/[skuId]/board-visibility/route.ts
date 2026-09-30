import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { AssetNotFoundError, hideAssetFromBoard, putAssetBackOnBoard } from "@/lib/assets/board-visibility";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";

export const dynamic = "force-dynamic";

const BoardVisibilitySchema = z.object({ hidden: z.boolean() });

/**
 * Takes a card off the board ({ hidden: true }) or puts it back ({ hidden: false }). Nothing is
 * deleted: a hidden asset keeps its status, history, files and payments.
 */
export async function POST(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canAssignArtists) return NextResponse.json({ error: "Only the team can hide or show cards" }, { status: 403 });

  const parsed = BoardVisibilitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { hidden: true } or { hidden: false }" }, { status: 400 });

  try {
    if (parsed.data.hidden) await hideAssetFromBoard(skuId, user.personnelId ?? null);
    else await putAssetBackOnBoard(skuId, user.personnelId ?? null);
  } catch (error) {
    if (error instanceof AssetNotFoundError) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    throw error;
  }
  // The uploader queue is a cached view and lists ready-for-upload cards.
  revalidateViews(CACHE_TAGS.publisherQueue);
  return NextResponse.json({ success: true });
}
