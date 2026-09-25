"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { jsonFetcher } from "@/lib/fetcher";
import { apiCall } from "@/lib/api-client";
import { formatDate } from "@/lib/format-date";

interface AssetOffer {
  id: string;
  status: "pending" | "extension_requested" | "accepted" | "declined" | "withdrawn";
  artistName: string;
  offeredDeadline: string;
  requestedDeadline: string | null;
  extensionReason: string | null;
  extensionDecision: string | null;
  agreedDeadline: string | null;
  declineReason: string | null;
  respondedAt: string | null;
  createdAt: string;
}

// The board reads this key; its cards show the offer badge.
const BOARD_KEY = "/api/assets";

/**
 * Where the asset's offer stands, inside the Artist Assignment section of the drawer: waiting,
 * accepted, a requested deadline to approve or reject, or declined and why. Someone who can
 * assign artists can also resend the offer, and decide deadline requests here.
 */
export function AssetOfferStatus({
  sku,
  hasArtist,
  canManage,
  enabled,
}: {
  sku: string;
  hasArtist: boolean;
  canManage: boolean;
  /** Only fetch while the drawer is open. */
  enabled: boolean;
}) {
  const offerKey = enabled ? `/api/assets/${encodeURIComponent(sku)}/offer` : null;
  const { data, mutate } = useSWR<{ offer: AssetOffer | null }>(offerKey, jsonFetcher);
  const { mutate: globalMutate } = useSWRConfig();
  const [submitting, setSubmitting] = useState(false);
  const offer = data?.offer ?? null;

  async function post(path: string, successMessage: string) {
    setSubmitting(true);
    try {
      const { ok, data: result } = await apiCall(path, { method: "POST" });
      if (!ok) {
        toast.error(result.error || "Something went wrong. Try again.");
        return;
      }
      toast.success(successMessage);
      await Promise.all([mutate(), globalMutate(BOARD_KEY)]);
    } finally {
      setSubmitting(false);
    }
  }

  const resendButton = canManage && hasArtist && (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={submitting}
      onClick={() => post(`/api/assets/${encodeURIComponent(sku)}/offer`, "Offer sent to the artist")}
    >
      {offer ? "Resend offer" : "Send offer"}
    </Button>
  );

  if (!offer) {
    return hasArtist ? (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>The artist hasn&apos;t been sent an offer for this asset.</span>
        {resendButton}
      </div>
    ) : null;
  }

  if (offer.status === "pending") {
    return (
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-amber-600 dark:text-amber-400">
          Offered to {offer.artistName} on {formatDate(offer.createdAt)}, due {formatDate(offer.offeredDeadline)}. Waiting
          for their answer.
          {offer.extensionDecision === "rejected" && " Their request for a later deadline was rejected."}
        </span>
        {resendButton}
      </div>
    );
  }

  if (offer.status === "extension_requested") {
    return (
      <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
        <p>
          <strong>{offer.artistName}</strong> asked for <strong>{formatDate(offer.requestedDeadline)}</strong> instead of{" "}
          {formatDate(offer.offeredDeadline)}.
        </p>
        <p className="text-muted-foreground">Reason: {offer.extensionReason || "None given"}</p>
        {canManage && (
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={submitting}
              onClick={() => post(`/api/offers/${offer.id}/approve-extension`, "New deadline approved. The artist has been told.")}
            >
              Approve new deadline
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={submitting}
              onClick={() => post(`/api/offers/${offer.id}/reject-extension`, "Request rejected. The artist has been told.")}
            >
              Reject
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (offer.status === "accepted") {
    return (
      <p className="text-xs text-emerald-600 dark:text-emerald-400">
        Accepted by {offer.artistName} on {formatDate(offer.respondedAt)}. Deadline {formatDate(offer.agreedDeadline)}
        {offer.extensionDecision === "approved" && " (a later date they asked for, approved)"}.
      </p>
    );
  }

  if (offer.status === "declined") {
    return (
      <div className="space-y-1 text-xs">
        <p className="text-destructive">
          {offer.artistName} declined on {formatDate(offer.respondedAt)}.
        </p>
        <p className="text-muted-foreground">Reason: {offer.declineReason || "None given"}</p>
      </div>
    );
  }

  return null;
}
