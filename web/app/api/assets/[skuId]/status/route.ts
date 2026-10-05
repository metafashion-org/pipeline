import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse, after } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import { TransitionRefusedError } from "@/lib/kanban/transition-errors";
import { z } from "zod";
import { revalidateViews, CACHE_TAGS } from "@/lib/cache/tags";
import { notifyArtistOfStatusChange } from "@/lib/notifications/artist-status";
import { isArtistNotifiedStatus } from "@/lib/notifications/artist-notified-statuses";
import { notifyArtistOfPayment, notifyReviewersOfReview, notifyUploadersOfReadyAsset } from "@/lib/notifications/pipeline-notices";

const StatusSchema = z.object({
  status: z.string().optional(),
  newStatus: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ skuId: string }> }
) {
  try {
    const [{ skuId }, user] = await Promise.all([params, getAuthedUser()]);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = StatusSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json({ error: "New status is required" }, { status: 400 });
    }

    const newStatus = parseResult.data.status || parseResult.data.newStatus;
    if (!newStatus) {
      return NextResponse.json({ error: "New status string is required" }, { status: 400 });
    }

    // The caller's real roles, not session.user.role — that collapses curator, publisher,
    // marketing and payment_admin all into "artist", which handed every one of them the
    // artist path through the transition rules.
    const result = await updateAssetStatusInKanban(skuId, newStatus, {
      roles: user.roles,
      personnelId: user.personnelId,
      caps: user.caps,
    });

    // Approved (hand in the final files) and Revisions Requested (make the changes, then send it back
    // for review) are the artist's cue, so they're told by email and Discord. Never throws, so it
    // can't undo the move.
    if (result.changed && isArtistNotifiedStatus(newStatus)) await notifyArtistOfStatusChange(skuId, newStatus);

    // The next person's cue: the reviewers when work goes to In Review, the uploaders at Ready for
    // Upload, the artist at Payment Done. Sent after the response, so the move doesn't wait on email
    // and Discord; each notice never throws.
    if (result.changed) {
      if (newStatus === "in_review") after(() => notifyReviewersOfReview(skuId));
      else if (newStatus === "ready_for_upload") after(() => notifyUploadersOfReadyAsset(skuId));
      else if (newStatus === "payment_done") after(() => notifyArtistOfPayment([skuId]));
    }

    // A status change can move an asset into or out of the Uploader Queue, and into Marketing's
    // "uploaded but not marketed" list, so both cached views are dropped rather than guessing which
    // transition this was.
    revalidateViews(CACHE_TAGS.publisherQueue, CACHE_TAGS.marketing);
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    console.error("Error in status update endpoint:", error);
    // A refused move carries its own status (403 for a permission refusal) plus a code, a title,
    // the reason and what to do instead, which the board shows as they are. Any other failure is a
    // bad request (400).
    if (error instanceof TransitionRefusedError) {
      return NextResponse.json(
        { error: error.message, code: error.code, title: error.title, reason: error.reason, hint: error.hint },
        { status: error.httpStatus }
      );
    }
    return NextResponse.json({ error: errorMessage(error, "Failed to update status") }, { status: 400 });
  }
}
