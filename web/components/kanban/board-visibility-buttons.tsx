"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { EyeOff, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/format-date";
import { Input } from "@/components/ui/input";
import { DriveImage } from "./drive-image";

// The board's own data (Board.tsx); refreshed so a hidden card leaves it and a restored one returns.
const BOARD_DATA_URL = "/api/assets";
const HIDDEN_CARDS_URL = "/api/assets/hidden";

interface HiddenCard {
  sku: string;
  itemName: string;
  currentStatus: string;
  statusLabel: string;
  coverFileId: string | null;
  artistName: string | null;
  hiddenAt: string;
  hiddenByName: string | null;
  hiddenReason: string | null;
}

async function setHidden(sku: string, hidden: boolean): Promise<boolean> {
  const { ok, data } = await apiCall(`/api/assets/${encodeURIComponent(sku)}/board-visibility`, {
    method: "POST",
    body: { hidden },
  });
  if (!ok) toast.error(data.error || "Couldn't change the card");
  return ok;
}

/**
 * Takes this card off the board, for old or finished work nobody needs to see. Nothing is deleted:
 * the board's Archived list puts it back.
 */
export function HideCardButton({ sku, itemName }: { sku: string; itemName: string }) {
  const { mutate } = useSWRConfig();
  const [saving, setSaving] = useState(false);

  async function hide() {
    setSaving(true);
    try {
      if (!(await setHidden(sku, true))) return;
      toast.success(`${itemName} is archived. Find it under Archived on the board.`);
      // The card leaves the board, which unmounts it and closes this drawer with it.
      await mutate(BOARD_DATA_URL);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 border-t pt-4">
      <p className="text-xs text-muted-foreground">Old or finished work nobody needs to see can come off the board. Nothing is deleted.</p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" className="shrink-0" disabled={saving}>
            <EyeOff className="h-3.5 w-3.5" /> Hide from board
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide {itemName} from the board?</AlertDialogTitle>
            <AlertDialogDescription>
              It leaves the board, the artist&apos;s My Tasks, the calendar and the uploader queue. Its status, files, history and
              payments stay as they are, and the Archived list puts it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={hide}>Hide from board</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The board toolbar's Archived list: a grid of the cards taken off the board, each with its picture,
 * SKU, status, why and when it was archived, and a button that puts it back.
 */
export function HiddenCardsButton() {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  // Loaded only while the list is open.
  const { data, mutate: reloadHidden } = useSWR<{ hidden: HiddenCard[] }>(open ? HIDDEN_CARDS_URL : null, jsonFetcher);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const hidden = (data?.hidden ?? []).filter((card) => !needle || `${card.sku} ${card.itemName}`.toLowerCase().includes(needle));

  async function putBack(card: HiddenCard) {
    setRestoring(card.sku);
    try {
      if (!(await setHidden(card.sku, false))) return;
      toast.success(`${card.itemName} is back on the board.`);
      await Promise.all([reloadHidden(), mutate(BOARD_DATA_URL)]);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5" /> Archived
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Archived cards</DialogTitle>
          <DialogDescription>
            Cards taken off the board. Their status, files, history and payments are unchanged. Put one back to see it on the board again.
          </DialogDescription>
        </DialogHeader>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by SKU or name" className="h-8" autoComplete="off" />
        <div className="max-h-[65vh] overflow-y-auto">
          {!data && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
          {data && hidden.length === 0 && <p className="p-4 text-sm text-muted-foreground">{needle ? "Nothing matches." : "No archived cards."}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {hidden.map((card) => (
              <div key={card.sku} className="flex flex-col overflow-hidden rounded-lg border bg-card">
                <div className="relative aspect-square bg-muted">
                  {card.coverFileId ? (
                    <DriveImage fileId={card.coverFileId} alt={card.itemName} sizes="240px" className="object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-xs text-muted-foreground">No image</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <p className="font-mono text-[11px] text-muted-foreground">{card.sku}</p>
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{card.itemName}</p>
                  <p className="text-xs text-muted-foreground">
                    {card.statusLabel}
                    {card.artistName ? ` · ${card.artistName}` : ""}
                  </p>
                  {card.hiddenReason && (
                    <p className="text-xs">
                      <span className="text-muted-foreground">Why: </span>
                      {card.hiddenReason}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Archived {formatDateTime(card.hiddenAt)}
                    {card.hiddenByName ? ` by ${card.hiddenByName}` : ""}
                  </p>
                  <Button size="sm" variant="outline" className="mt-auto w-full" disabled={restoring === card.sku} onClick={() => putBack(card)}>
                    <Undo2 className="h-3.5 w-3.5" /> {restoring === card.sku ? "Putting back..." : "Put back"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
