"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiCall } from "@/lib/api-client";
import { ARCHIVE_REASONS, archiveReasonText } from "@/lib/assets/archive-reasons";

// A card's own reason, or the one picked for all of them.
const SAME_AS_ALL = "__same__";
const BOARD_DATA_URL = "/api/assets";
const HIDDEN_CARDS_URL = "/api/assets/hidden";

interface PickedCard {
  sku: string;
  itemName: string;
}

/**
 * Archives the picked cards: one reason (from the dropdown, with an optional note) for all of them,
 * and any card can have its own instead. Archived cards leave the board, nothing is deleted, and
 * they show on the board's Archived list with the reason, who archived them and when.
 */
export function ArchiveCardsDialog({ cards, open, onOpenChange, onArchived }: { cards: PickedCard[]; open: boolean; onOpenChange: (open: boolean) => void; onArchived: () => void }) {
  const { mutate } = useSWRConfig();
  const [reason, setReason] = useState<string>(ARCHIVE_REASONS[0]);
  const [note, setNote] = useState("");
  const [own, setOwn] = useState<Record<string, { reason: string; note: string }>>({});
  const [working, setWorking] = useState(false);

  function setOwnReason(sku: string, value: Partial<{ reason: string; note: string }>) {
    setOwn((o) => ({ ...o, [sku]: { reason: o[sku]?.reason ?? SAME_AS_ALL, note: o[sku]?.note ?? "", ...value } }));
  }

  async function archive() {
    setWorking(true);
    try {
      const items = cards.map((card) => {
        const mine = own[card.sku];
        const useOwn = mine && mine.reason !== SAME_AS_ALL;
        return { sku: card.sku, reason: useOwn ? archiveReasonText(mine.reason, mine.note) : archiveReasonText(reason, mine?.note || note) };
      });
      const { ok, data } = await apiCall<{ archived: string[] }>("/api/assets/archive", { method: "POST", body: { items } });
      if (!ok) {
        toast.error(data.error || "Couldn't archive them");
        return;
      }
      toast.success(`Archived ${data.archived.length} card${data.archived.length === 1 ? "" : "s"}. They're on the Archived list.`);
      setOwn({});
      setNote("");
      onOpenChange(false);
      onArchived();
      await Promise.all([mutate(BOARD_DATA_URL), mutate(HIDDEN_CARDS_URL)]);
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Archive {cards.length} card{cards.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>They leave the board. Nothing is deleted, and any of them can be put back from the Archived list.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
          <div className="space-y-1">
            <Label>Reason for all of them</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ARCHIVE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="archive-note">Note (optional)</Label>
            <Input id="archive-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Christmas 2025 trend, not making these" />
          </div>
        </div>

        <div className="max-h-[45vh] overflow-y-auto divide-y divide-border rounded-md border">
          {cards.map((card) => {
            const mine = own[card.sku];
            return (
              <div key={card.sku} className="grid gap-2 p-2 sm:grid-cols-[1fr_190px_1fr] sm:items-center">
                <p className="min-w-0 truncate text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{card.sku}</span> {card.itemName}
                </p>
                <Select value={mine?.reason ?? SAME_AS_ALL} onValueChange={(v) => setOwnReason(card.sku, { reason: v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SAME_AS_ALL}>Same as above</SelectItem>
                    {ARCHIVE_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={mine?.note ?? ""}
                  onChange={(e) => setOwnReason(card.sku, { note: e.target.value })}
                  placeholder="Its own note (optional)"
                  className="h-8 text-xs"
                />
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={archive} disabled={working || cards.length === 0}>
            <Archive className="h-3.5 w-3.5" /> {working ? "Archiving..." : `Archive ${cards.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
