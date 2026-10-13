"use client";

import { useState } from "react";
import Image from "next/image";
import useSWR from "swr";
import { toast } from "sonner";
import { ExternalLink, RefreshCw, Sheet, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import type { PreviewItem, PreviewListing } from "@/lib/marketing/todays-picks-service";
import { NominationPanel } from "./NominationPanel";

const PREVIEW_URL = "/api/admin/marketing/todays-picks";
const THUMBNAIL_PX = 160;

interface PreviewResponse {
  items: PreviewItem[];
  sheetUrl: string | null;
  nominations: Record<string, { state: string; finalName: string; submittedAt: string | null; attemptNo: number }>;
}

function formatCheckTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** One listing: a square thumbnail, its link underneath, our tick next to what Roblox showed, and the main-listing toggle. */
function ListingTile({ listing, index, busy, onMain }: { listing: PreviewListing; index: number; busy: boolean; onMain: () => void }) {
  const check = listing.lastCheck;
  const mismatch = check && !check.error && check.isForSale !== check.ourOnSale;
  return (
    <div className={`flex flex-col gap-1 rounded-md border p-1.5 text-[11px] ${listing.isMain ? "border-primary ring-1 ring-primary" : ""}`}>
      <div className="relative aspect-square w-full overflow-hidden rounded bg-muted">
        {listing.thumbnailUrl ? (
          <Image src={listing.thumbnailUrl} alt={check?.robloxName ?? `Listing ${index + 1}`} width={THUMBNAIL_PX} height={THUMBNAIL_PX} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">No thumbnail</div>
        )}
      </div>
      <a href={listing.url} target="_blank" rel="noopener noreferrer" className="truncate text-primary hover:underline">
        {listing.variantLabel || check?.robloxName || `Link ${index + 1}`}
        <ExternalLink className="ml-1 inline h-3 w-3" />
      </a>
      <p className="font-mono text-muted-foreground">{listing.robloxAssetId}</p>
      <p className={mismatch ? "font-medium text-destructive" : "text-muted-foreground"}>
        Ours: {listing.onSaleAt ? "on sale" : "off sale"} · Roblox:{" "}
        {check ? (check.error ? "check failed" : `${check.isForSale ? "on sale" : "off sale"}${check.priceRobux !== null ? `, ${check.priceRobux} R$` : ""}`) : "not checked"}
      </p>
      {check && <p className="text-muted-foreground">Checked {formatCheckTime(check.checkedAt)}</p>}
      <Button size="sm" variant={listing.isMain ? "default" : "outline"} className="h-6 px-2 text-[11px]" disabled={busy} onClick={onMain}>
        <Star className="mr-1 h-3 w-3" />
        {listing.isMain ? "Main listing" : "Make main"}
      </Button>
    </div>
  );
}

/**
 * Connects Arjun's private sheet: he makes a Google Sheet in his own My Drive, shares it with the
 * service account only, and pastes its link. The server refuses a sheet anyone else can open.
 */
function ConnectSheet({ onConnected }: { onConnected: () => void }) {
  const { data } = useSWR<{ serviceAccountEmail: string | null }>(`${PREVIEW_URL}/sheet/connect`, jsonFetcher, { revalidateOnFocus: false });
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try {
      const { ok, data: res } = await apiCall<{ error?: string }>(`${PREVIEW_URL}/sheet/connect`, { method: "POST", body: { url } });
      if (!ok) toast.error(res.error || "Couldn't connect the sheet");
      else {
        toast.success("Sheet connected");
        onConnected();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded-lg border bg-card p-3 text-sm">
      <h2 className="font-semibold">Connect your private sheet</h2>
      <ol className="list-inside list-decimal space-y-0.5 text-xs text-muted-foreground">
        <li>In arjun@metafashion.in&apos;s My Drive (not a shared drive), make a blank Google Sheet.</li>
        <li>
          Share it as Editor with <span className="font-mono text-foreground">{data?.serviceAccountEmail ?? "the Kanban's service account"}</span> and nobody else. Leave general access Restricted.
        </li>
        <li>Paste its link here. The Kanban adds the Items, Listings, Suggestions and Sync log tabs.</li>
      </ol>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
        />
        <Button size="sm" className="h-8" disabled={busy || !url.trim()} onClick={connect}>
          {busy ? "Checking…" : "Connect"}
        </Button>
      </div>
    </section>
  );
}

/**
 * Today's Picks preview: every live SKU with its listings in a thumbnail grid. Arjun picks each SKU's
 * main listing here, checks listings on Roblox, and writes everything to the private sheet. Nothing
 * on this page drafts or submits a nomination.
 */
export function TodaysPicksPreview() {
  const { data, mutate, isLoading } = useSWR<PreviewResponse>(PREVIEW_URL, jsonFetcher, { revalidateOnFocus: false });
  const [busySku, setBusySku] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [openSku, setOpenSku] = useState<string | null>(null);

  async function setMain(sku: string, listing: PreviewListing) {
    setBusySku(sku);
    try {
      const { ok, data: res } = await apiCall<{ error?: string }>(`${PREVIEW_URL}/main`, { method: "PUT", body: { sku, linkId: listing.isMain ? null : listing.id } });
      if (!ok) toast.error(res.error || "Couldn't change the main listing");
      await mutate();
    } finally {
      setBusySku(null);
    }
  }

  async function checkSku(sku: string): Promise<boolean> {
    const { ok, data: res } = await apiCall<{ error?: string; failed: number; stoppedEarly: boolean }>(`${PREVIEW_URL}/check`, { method: "POST", body: { sku } });
    if (!ok) {
      toast.error(`${sku}: ${res.error || "check failed"}`);
      return false;
    }
    if (res.stoppedEarly) {
      toast.error("Roblox asked us to slow down. The check stopped; try again later.");
      return false;
    }
    if (res.failed > 0) toast.warning(`${sku}: ${res.failed} listings couldn't be checked`);
    return true;
  }

  async function checkOne(sku: string) {
    setBusySku(sku);
    try {
      await checkSku(sku);
      await mutate();
    } finally {
      setBusySku(null);
    }
  }

  // One SKU after another, so Roblox sees one request per second throughout.
  async function checkAll() {
    if (!data) return;
    setCheckingAll(true);
    try {
      for (const item of data.items) {
        setBusySku(item.sku);
        if (!(await checkSku(item.sku))) break;
        await mutate();
      }
    } finally {
      setBusySku(null);
      setCheckingAll(false);
    }
  }

  async function syncSheet() {
    setSyncing(true);
    try {
      const { ok, data: res } = await apiCall<{ error?: string; items: number; listings: number; suggestions: { added: number; refused: number } }>(`${PREVIEW_URL}/sheet`, { method: "POST" });
      if (!ok) toast.error(res.error || "Sheet sync failed");
      else toast.success(`Sheet updated: ${res.items} SKUs, ${res.listings} listings, ${res.suggestions.added} new suggestions${res.suggestions.refused ? `, ${res.suggestions.refused} refused (see Sync log)` : ""}`);
      await mutate();
    } finally {
      setSyncing(false);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading listings…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Couldn&apos;t load the preview.</p>;

  const ready = data.items.filter((item) => item.blockers.length === 0).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {data.items.length} live SKUs · {ready} with nothing blocking · nominations are filed by Arjun on Roblox&apos;s form
        </p>
        <Button size="sm" variant="outline" disabled={checkingAll || !!busySku} onClick={checkAll}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${checkingAll ? "animate-spin" : ""}`} />
          Check all on Roblox
        </Button>
        {data.sheetUrl && (
          <>
            <Button size="sm" variant="outline" disabled={syncing} onClick={syncSheet}>
              <Sheet className="mr-1 h-3.5 w-3.5" />
              {syncing ? "Syncing…" : "Sync private sheet"}
            </Button>
            <a href={data.sheetUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
              Open sheet <ExternalLink className="inline h-3 w-3" />
            </a>
          </>
        )}
      </div>
      {!data.sheetUrl && <ConnectSheet onConnected={() => mutate()} />}

      {data.items.map((item) => (
        <section key={item.sku} className="space-y-2 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold leading-snug">{item.itemName}</h2>
              <p className="font-mono text-[11px] text-muted-foreground">
                {item.sku} · {item.brandGroup ?? "no group"} · {item.listings.filter((l) => l.onSaleAt).length}/{item.listings.length} ticked on sale ·{" "}
                {item.artifacts.length > 0 ? item.artifacts.map((a) => a.artifactId).join(", ") : "no artifacts"} · {item.referenceImageCount} reference images
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="self-center rounded bg-muted px-1.5 py-0.5 text-[11px]">Nomination: {data.nominations[item.sku]?.state ?? "not started"}</span>
              <Button size="sm" variant={openSku === item.sku ? "default" : "outline"} className="h-7 text-xs" onClick={() => setOpenSku(openSku === item.sku ? null : item.sku)}>
                {openSku === item.sku ? "Close nomination" : "Nomination"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!busySku} onClick={() => checkOne(item.sku)}>
                <RefreshCw className={`mr-1 h-3 w-3 ${busySku === item.sku ? "animate-spin" : ""}`} />
                Check on Roblox
              </Button>
            </div>
          </div>
          {item.blockers.length > 0 && (
            <ul className="list-inside list-disc text-xs text-amber-700 dark:text-amber-400">
              {item.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {openSku === item.sku && <NominationPanel sku={item.sku} onChanged={() => mutate()} />}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {item.listings.map((listing, index) => (
              <ListingTile key={listing.id} listing={listing} index={index} busy={busySku === item.sku} onMain={() => setMain(item.sku, listing)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
