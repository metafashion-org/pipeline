"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ClipboardCheck, Undo2, CheckCircle2, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";
import type { CurationReview } from "@/lib/curation/curation-review";

// Dates cross the wire as ISO strings.
type CurationReviewWire = Omit<CurationReview, "submittedAt"> & { submittedAt: string };

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text);
}

function Value({ text }: { text: string }) {
  return isUrl(text) ? (
    <a href={text} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all dark:text-blue-400">
      {text}
    </a>
  ) : (
    <span className="whitespace-pre-line">{text}</span>
  );
}

/**
 * The asset drawer's section for a card in Curated: what the curator wrote, and, for the team, the
 * two ways to finish the review. Approving moves the card to Unassigned. Sending it back returns the
 * idea to the curator's drafts with a note and emails them; the card stays in Curated until they
 * send it again.
 */
export function CurationReviewSection({ sku, enabled, canReview }: { sku: string; enabled: boolean; canReview: boolean }) {
  const { data, mutate } = useSWR<{ review: CurationReviewWire | null }>(enabled ? `/api/assets/${encodeURIComponent(sku)}/curation` : null, jsonFetcher);
  const { mutate: globalMutate } = useSWRConfig();
  const [approving, setApproving] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const review = data?.review;
  const sentBack = review?.status === "draft";
  const curator = review?.curatorName || "the curator";

  async function approve() {
    setApproving(true);
    try {
      const { ok, data: result } = await apiCall<{ title?: string; reason?: string }>(`/api/assets/${encodeURIComponent(sku)}/status`, {
        method: "PATCH",
        body: { status: "unassigned" },
      });
      if (!ok) {
        toast.error(result.title || result.error || "Couldn't approve it", { description: result.reason });
        return;
      }
      toast.success("Approved. It's in Unassigned, ready to assign.");
      globalMutate("/api/assets");
    } finally {
      setApproving(false);
    }
  }

  async function sendBack() {
    setSending(true);
    try {
      const { ok, data: result } = await apiCall<{ curatorEmail: string | null }>(`/api/assets/${encodeURIComponent(sku)}/curation`, {
        method: "POST",
        body: { note },
      });
      if (!ok) {
        toast.error(result.error || "Couldn't send it back");
        return;
      }
      toast.success(result.curatorEmail ? `Sent back to ${curator}. They've been emailed.` : `Sent back to ${curator}.`);
      setSendBackOpen(false);
      setNote("");
      mutate();
      globalMutate("/api/assets");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <ClipboardCheck className="h-3.5 w-3.5" /> Curation review
      </h4>
      <div className="bg-muted/30 p-3 rounded-md text-sm space-y-3">
        {!data && <p className="text-xs text-muted-foreground">Loading the curator&apos;s notes…</p>}
        {data && !review && <p className="text-xs text-muted-foreground">This card didn&apos;t come from the Curation form.</p>}
        {review && (
          <>
            <p className="text-xs text-muted-foreground">
              Curated by {review.curatorName || "an unknown curator"}, sent {formatDate(review.submittedAt)}
            </p>

            {sentBack && review.reviewNote && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 flex gap-2">
                <MessageSquareWarning className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium">Sent back to {curator}. Waiting for their changes.</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-line">{review.reviewNote}</p>
                </div>
              </div>
            )}

            {review.fields.length > 0 ? (
              <dl className="grid gap-2">
                {review.fields.map((field) => (
                  <div key={field.label}>
                    <dt className="text-xs text-muted-foreground">{field.label}</dt>
                    <dd>
                      <Value text={field.value} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground italic">The curator didn&apos;t fill in any other fields.</p>
            )}

            {review.sourceLinks.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Source links</p>
                <ul className="space-y-0.5">
                  {review.sourceLinks.map((link) => (
                    <li key={link}>
                      <Value text={link} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canReview && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" onClick={approve} disabled={approving}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> {approving ? "Approving..." : "Approve for production"}
                </Button>
                {!sentBack && (
                  <Dialog open={sendBackOpen} onOpenChange={setSendBackOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        <Undo2 className="h-3.5 w-3.5" /> Send back
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[440px]">
                      <DialogHeader>
                        <DialogTitle>Send back to {curator}</DialogTitle>
                        <DialogDescription>
                          The idea goes back to their drafts with your note, and they&apos;re emailed. The card stays in
                          Curated until they send it again.
                        </DialogDescription>
                      </DialogHeader>
                      <Textarea
                        id="curation-send-back-note"
                        rows={4}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="What should they change?"
                      />
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setSendBackOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={sendBack} disabled={!note.trim() || sending}>
                          {sending ? "Sending..." : "Send back"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
