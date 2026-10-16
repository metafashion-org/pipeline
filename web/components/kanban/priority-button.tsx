"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiCall } from "@/lib/api-client";

// The board's own data (Board.tsx); refreshed so the card's highlight changes at once.
const BOARD_DATA_URL = "/api/assets";

/**
 * Marks the card priority, with an optional note, or clears the mark. Marking someone else's card
 * messages its artist on Discord (lib/assets/priority-service.ts).
 */
export function PriorityButton({ sku, isPriority, note }: { sku: string; isPriority: boolean; note: string | null }) {
  const { mutate } = useSWRConfig();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(priority: boolean) {
    setSaving(true);
    try {
      const { ok, data } = await apiCall<{ messaged?: { dm: boolean; channel: boolean } }>(`/api/assets/${encodeURIComponent(sku)}/priority`, {
        method: "POST",
        body: { priority, note: draft || null },
      });
      if (!ok) {
        toast.error(data.error || "Couldn't change the priority");
        return;
      }
      const sent = data.messaged;
      toast.success(!priority ? "Priority cleared" : sent?.dm || sent?.channel ? "Marked priority and messaged the artist on Discord" : "Marked priority");
      setDraft("");
      await mutate(BOARD_DATA_URL);
    } finally {
      setSaving(false);
    }
  }

  if (isPriority) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3">
        <p className="text-sm">
          <Flag className="mr-1 inline h-4 w-4 text-red-600" aria-hidden="true" />
          Priority{note ? `: ${note}` : ""}
        </p>
        <Button variant="outline" size="sm" disabled={saving} onClick={() => save(false)}>
          Clear
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Why it's a priority (optional)" aria-label="Priority note" />
      <Button variant="outline" size="sm" disabled={saving} onClick={() => save(true)}>
        <Flag className="mr-1 h-4 w-4" aria-hidden="true" />
        Mark priority
      </Button>
    </div>
  );
}
