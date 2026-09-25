"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DriveImage } from "@/components/kanban/drive-image";
import { jsonFetcher } from "@/lib/fetcher";
import { apiCall } from "@/lib/api-client";
import { formatFee } from "@/lib/format-money";
import { formatDate } from "@/lib/format-date";

interface ArtistOffer {
  id: string;
  status: "pending" | "extension_requested";
  sku: string;
  itemName: string;
  category: string | null;
  imageFileId: string | null;
  feeAmount: string | null;
  currency: string | null;
  offeredDeadline: string;
  requestedDeadline: string | null;
  extensionDecision: string | null;
}

interface OffersResponse {
  offers: ArtistOffer[];
  maxExtensionDays: number;
}

const OFFERS_KEY = "/api/offers/mine";
// My Tasks' own board reads this key; an accept or decline changes what it shows.
const BOARD_KEY = "/api/assets";

// The date input wants YYYY-MM-DD, offset from the offered deadline by whole days.
function addDaysAsDateInput(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type OpenForm = "none" | "extension" | "decline";

function OfferCard({ offer, maxExtensionDays }: { offer: ArtistOffer; maxExtensionDays: number }) {
  const { mutate } = useSWRConfig();
  const [openForm, setOpenForm] = useState<OpenForm>("none");
  const [requestedDate, setRequestedDate] = useState(() => addDaysAsDateInput(offer.offeredDeadline, 1));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isWaitingOnTeam = offer.status === "extension_requested";
  const wasRejected = offer.status === "pending" && offer.extensionDecision === "rejected";

  async function send(path: string, body: object, successMessage: string) {
    setSubmitting(true);
    try {
      const { ok, data } = await apiCall(`/api/offers/${offer.id}/${path}`, { method: "POST", body });
      if (!ok) {
        toast.error(data.error || "Something went wrong. Try again.");
        return;
      }
      toast.success(successMessage);
      setOpenForm("none");
      setReason("");
      await Promise.all([mutate(OFFERS_KEY), mutate(BOARD_KEY)]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3 flex gap-3">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
        {offer.imageFileId ? (
          <DriveImage fileId={offer.imageFileId} alt={offer.itemName} sizes="96px" className="object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-muted-foreground">No image</span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="font-semibold leading-tight">{offer.itemName}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{offer.sku}</span>
            {offer.category ? ` · ${offer.category}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">Fee </span>
            {formatFee(offer.feeAmount, offer.currency, "Not set")}
          </span>
          <span>
            <span className="text-muted-foreground">Deadline </span>
            {formatDate(offer.offeredDeadline)}
          </span>
        </div>

        {isWaitingOnTeam && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            You asked for {formatDate(offer.requestedDeadline)}. Waiting for the team to answer.
          </p>
        )}
        {wasRejected && (
          <p className="text-sm text-muted-foreground">
            Your request for {formatDate(offer.requestedDeadline)} wasn&apos;t approved. Accept at the original
            deadline, or decline.
          </p>
        )}

        {openForm === "none" && (
          <div className="flex flex-wrap gap-2">
            {!isWaitingOnTeam && (
              <>
                <Button size="sm" disabled={submitting} onClick={() => send("accept", {}, "Accepted. The full brief is on its way by email.")}>
                  Accept
                </Button>
                {!wasRejected && (
                  <Button size="sm" variant="outline" disabled={submitting} onClick={() => setOpenForm("extension")}>
                    Ask for more time
                  </Button>
                )}
              </>
            )}
            <Button size="sm" variant="ghost" disabled={submitting} onClick={() => setOpenForm("decline")}>
              Decline
            </Button>
          </div>
        )}

        {openForm === "extension" && (
          <div className="space-y-2 rounded-md border p-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`extension-date-${offer.id}`}>New deadline</Label>
              <Input
                id={`extension-date-${offer.id}`}
                type="date"
                value={requestedDate}
                min={addDaysAsDateInput(offer.offeredDeadline, 1)}
                max={addDaysAsDateInput(offer.offeredDeadline, maxExtensionDays)}
                onChange={(e) => setRequestedDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Up to {maxExtensionDays} days later. The team approves it before it counts.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`extension-reason-${offer.id}`}>Reason (optional)</Label>
              <Textarea
                id={`extension-reason-${offer.id}`}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={submitting}
                onClick={() =>
                  send("request-extension", { requestedDeadline: requestedDate, reason }, "Request sent. You'll hear back by email and Discord.")
                }
              >
                Send request
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpenForm("none")}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {openForm === "decline" && (
          <div className="space-y-2 rounded-md border p-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`decline-reason-${offer.id}`}>Why are you declining? (optional)</Label>
              <Textarea
                id={`decline-reason-${offer.id}`}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="The fee, the deadline, the style, something else?"
              />
              <p className="text-xs text-muted-foreground">It helps us fix whatever is causing it.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={submitting} onClick={() => send("decline", { reason }, "Declined. Thanks for letting us know.")}>
                Decline offer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpenForm("none")}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The artist's open offers, at the top of My Tasks. Each one can be accepted, answered with a
 * request for a later deadline, or declined with an optional reason. Hidden when there's nothing
 * waiting. The `offers` anchor is where the offer email and Discord message link to.
 */
export function OffersPanel() {
  const { data } = useSWR<OffersResponse>(OFFERS_KEY, jsonFetcher);
  const offers = data?.offers ?? [];
  if (offers.length === 0) return null;

  return (
    <section id="offers" className="space-y-2">
      <h2 className="text-sm font-semibold">
        New offers <span className="text-muted-foreground font-normal">({offers.length})</span>
      </h2>
      <div className="grid gap-2 lg:grid-cols-2">
        {offers.map((offer) => (
          <OfferCard key={offer.id} offer={offer} maxExtensionDays={data?.maxExtensionDays ?? 1} />
        ))}
      </div>
    </section>
  );
}
