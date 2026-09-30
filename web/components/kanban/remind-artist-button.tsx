"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiCall } from "@/lib/api-client";
import type { ArtistNotifiedStatus } from "@/lib/notifications/artist-notified-statuses";

/**
 * Sends the artist the notice for their card's current status again: the approval email and Discord
 * ping with the link to hand in final files, or the revisions one with what to do next. For a card
 * that moved before these notices existed, or an artist who says they didn't get it.
 */
export function RemindArtistButton({ sku, artistName, status }: { sku: string; artistName: string; status: ArtistNotifiedStatus }) {
  const [sending, setSending] = useState(false);
  const notice = status === "approved" ? "approval" : "revisions";

  async function remind() {
    setSending(true);
    try {
      const { ok, data } = await apiCall(`/api/assets/${encodeURIComponent(sku)}/status-notice`, { method: "POST" });
      if (!ok) {
        toast.error(data.error || "Couldn't remind the artist");
        return;
      }
      toast.success(`Sent ${artistName} the ${notice} email and Discord ping again.`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
      <p className="text-xs text-muted-foreground">Sends {artistName} the {notice} email and Discord ping again.</p>
      <Button size="sm" variant="outline" onClick={remind} disabled={sending} className="shrink-0">
        <BellRing className="h-3.5 w-3.5" />
        {sending ? "Sending..." : "Remind the artist"}
      </Button>
    </div>
  );
}
