import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { addAssetComment, AssetCommentError, listAssetComments, listMentionablePeople } from "@/lib/asset-comments/asset-comments-service";

export const dynamic = "force-dynamic";

const MAX_COMMENT_CHARS = 10_000;

const CommentSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
  // The people picked from the @ list: team members and freelancers. z.guid() rather than z.uuid(),
  // which rejects ids without an RFC version digit, like the e2e fixtures' 11111111-... ids.
  mentionedIds: z.array(z.guid()).default([]),
});

// Comments are internal notes about an asset, so only people who see every asset read or write them.
async function staffUser() {
  const user = await getAuthedUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!user.caps.canViewAllAssets) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

function errorResponse(error: unknown) {
  if (error instanceof AssetCommentError) return NextResponse.json({ error: error.message }, { status: 404 });
  throw error;
}

/** The asset's comments and the people a new comment can mention. */
export async function GET(_request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, auth] = await Promise.all([params, staffUser()]);
  if (auth.error) return auth.error;
  try {
    const [comments, people] = await Promise.all([listAssetComments(skuId), listMentionablePeople(skuId)]);
    return NextResponse.json({ comments, people: people.map(({ id, name, freelancer }) => ({ id, name, freelancer })) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Adds a comment and notifies everyone @mentioned in it. */
export async function POST(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const [{ skuId }, auth] = await Promise.all([params, staffUser()]);
  if (auth.error) return auth.error;
  const parsed = CommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write something first" }, { status: 400 });
  try {
    const id = await addAssetComment(skuId, parsed.data.body, parsed.data.mentionedIds, auth.user.personnelId ?? null);
    return NextResponse.json({ id });
  } catch (error) {
    return errorResponse(error);
  }
}
