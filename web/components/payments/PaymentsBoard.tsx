"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Wallet, FileUp, Loader2, CheckCircle2 } from "lucide-react";
import { jsonFetcher } from "@/lib/fetcher";
import { formatFee } from "@/lib/format-money";
import type { ArtistPendingPayment } from "@/lib/payments/payment-batch-service";

// A small, stable set of accent colors so each artist's card reads distinctly at a glance without
// needing real avatar photos — hashed from their id so the same artist always gets the same one.
const AVATAR_PALETTES = [
  "bg-violet-500/15 text-violet-400 ring-violet-500/30",
  "bg-blue-500/15 text-blue-400 ring-blue-500/30",
  "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  "bg-amber-500/15 text-amber-400 ring-amber-500/30",
  "bg-rose-500/15 text-rose-400 ring-rose-500/30",
  "bg-cyan-500/15 text-cyan-400 ring-cyan-500/30",
];

function paletteFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

// One line of an artist's payout. "Already paid" records that it was paid outside the Kanban, with a
// note on how and when, and moves it to Payment Done with no invoice.
function PayoutLine({ asset, onPaid }: { asset: ArtistPendingPayment["assets"][number]; onPaid: () => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function markPaid() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payments/already-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: asset.sku, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Couldn't mark it paid");
        return;
      }
      toast.success(`${asset.sku} marked as already paid`);
      onPaid();
    } catch {
      toast.error("Couldn't reach the server, try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{asset.itemName}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{asset.sku}</span>
            {asset.category ? ` · ${asset.category}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium tabular-nums">{formatFee(asset.feeAmount, asset.currency, "—")}</p>
          {!asking && (
            <button type="button" onClick={() => setAsking(true)} className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Already paid
            </button>
          )}
        </div>
      </div>
      {asking && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How and when, e.g. UPI on 14 Oct"
            aria-label={`How ${asset.sku} was paid`}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          />
          <button
            type="button"
            disabled={saving || !note.trim()}
            onClick={markPaid}
            className="h-8 shrink-0 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Mark paid"}
          </button>
          <button type="button" disabled={saving} onClick={() => setAsking(false)} className="h-8 shrink-0 text-xs text-muted-foreground">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function ArtistPayoutCard({ artist, onAttached }: { artist: ArtistPendingPayment; onAttached: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currencies = Object.keys(artist.totalsByCurrency);
  const mixedCurrency = currencies.length > 1;

  async function attach(file: File) {
    if (mixedCurrency) {
      toast.error(`${artist.artistName}'s pending assets span ${currencies.length} currencies — pay each currency separately for now.`);
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Payment summaries must be a PDF");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("artistId", artist.artistId);
      formData.set("file", file);
      const res = await fetch("/api/admin/payments/attach", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to attach payment summary");
        return;
      }
      toast.success(`${artist.artistName} marked as paid — ${data.assetCount} asset${data.assetCount === 1 ? "" : "s"}, ${formatFee(data.totalAmount, data.currency)}`);
      onAttached();
    } catch {
      toast.error("Upload failed — check your connection and try again");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md ${
        dragOver ? "border-primary ring-2 ring-primary/30" : "border-border"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) attach(file);
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-5 pb-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ${paletteFor(artist.artistId)}`}>
          {initials(artist.artistName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{artist.artistName}</p>
          <p className="truncate text-xs text-muted-foreground">{artist.artistEmail}</p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {artist.assets.length} asset{artist.assets.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Line items */}
      <div className="divide-y divide-border/60 border-t border-border/60 px-5">
        {artist.assets.map((a) => (
          <PayoutLine key={a.id} asset={a} onPaid={onAttached} />
        ))}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between border-t border-border px-5 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total</span>
        {mixedCurrency ? (
          <span className="text-sm font-semibold text-amber-500">
            {currencies.map((c) => formatFee(artist.totalsByCurrency[c], c)).join(" + ")}
          </span>
        ) : (
          <span className="text-lg font-bold tabular-nums">{formatFee(artist.totalsByCurrency[currencies[0]], currencies[0])}</span>
        )}
      </div>

      {/* Attach action */}
      <div className="p-4 pt-0">
        <button
          type="button"
          disabled={uploading || mixedCurrency}
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading & marking paid…
            </>
          ) : (
            <>
              <FileUp className="h-4 w-4" /> Attach Payment Summary (PDF)
            </>
          )}
        </button>
        {mixedCurrency && (
          <p className="mt-1.5 text-center text-[11px] text-amber-500">Split across currencies — pay each one separately.</p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) attach(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

export function PaymentsBoard({ initialArtists }: { initialArtists: ArtistPendingPayment[] }) {
  const { data, mutate, isLoading } = useSWR<{ artists?: ArtistPendingPayment[] }>("/api/admin/payments/artists", jsonFetcher, {
    fallbackData: { artists: initialArtists },
    revalidateOnMount: false,
    revalidateOnFocus: true,
  });

  const artists = data?.artists ?? [];
  const grandTotalsByCurrency: Record<string, number> = {};
  for (const artist of artists) {
    for (const [currency, amount] of Object.entries(artist.totalsByCurrency)) {
      grandTotalsByCurrency[currency] = (grandTotalsByCurrency[currency] || 0) + amount;
    }
  }
  const grandTotalLabel = Object.entries(grandTotalsByCurrency)
    .map(([currency, amount]) => formatFee(amount, currency))
    .join(" + ");

  if (!isLoading && artists.length === 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500/70" />
        <p className="text-sm font-medium">Nothing pending</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every approved asset is paid up. New payouts show up here as soon as something is marked for payment.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          {artists.length} artist{artists.length === 1 ? "" : "s"} awaiting payout
        </span>
        {grandTotalLabel && <span className="font-semibold text-foreground">{grandTotalLabel} owed</span>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {artists.map((artist) => (
          <ArtistPayoutCard key={artist.artistId} artist={artist} onAttached={() => mutate()} />
        ))}
      </div>
    </div>
  );
}
