"use client";

import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";

const NOT_ON_SALE_URL = "/api/admin/marketing/not-on-sale";

interface NotOnSaleLink {
  id: string;
  url: string;
  robloxAssetId: string | null;
  variantLabel: string | null;
  onSaleAt: string | null;
}

interface NotOnSaleAsset {
  sku: string;
  itemName: string;
  links: NotOnSaleLink[];
}

interface NotOnSaleResponse {
  assets: NotOnSaleAsset[];
}

/**
 * Live assets with a recolour still off sale, each with all its Roblox links. Ticking a box puts
 * that recolour on sale and unticking takes it off. Shown to Arjun only: the list route answers 403
 * for everyone else, and then this renders nothing.
 */
export function NotOnSaleList() {
  const router = useRouter();
  // No refetch on focus: Arjun switches to Roblox to put recolours on sale and comes back to tick
  // them, and a refetch then would drop an asset whose last box he just ticked. The list reloads
  // with the page.
  const { data, mutate } = useSWR<NotOnSaleResponse>(NOT_ON_SALE_URL, jsonFetcher, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const [busy, setBusy] = useState<Set<string>>(new Set());
  if (!data?.assets || data.assets.length === 0) return null;

  const offSaleCount = data.assets.reduce((sum, asset) => sum + asset.links.filter((link) => !link.onSaleAt).length, 0);

  function markBusy(linkIds: string[], on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      for (const id of linkIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  // Updates the boxes in place without refetching, so a ticked asset stays on screen.
  function setLocalOnSale(sku: string, linkIds: string[], onSale: boolean) {
    const stamp = onSale ? new Date().toISOString() : null;
    void mutate(
      (current) =>
        current && {
          assets: current.assets.map((asset) =>
            asset.sku !== sku ? asset : { ...asset, links: asset.links.map((link) => (linkIds.includes(link.id) ? { ...link, onSaleAt: stamp } : link)) }
          ),
        },
      { revalidate: false }
    );
  }

  async function setOnSale(sku: string, linkIds: string[], onSale: boolean) {
    markBusy(linkIds, true);
    const done: string[] = [];
    try {
      for (const linkId of linkIds) {
        const { ok, data: res } = await apiCall(`/api/assets/${encodeURIComponent(sku)}/roblox-links/${linkId}`, { method: "PATCH", body: { onSale } });
        if (!ok) {
          toast.error(res.error || "Couldn't change it");
          break;
        }
        done.push(linkId);
      }
      if (done.length > 0) {
        setLocalOnSale(sku, done, onSale);
        // The marketing list below is server-rendered; an asset with a recolour on sale belongs in it.
        router.refresh();
      }
    } finally {
      markBusy(linkIds, false);
    }
  }

  return (
    <section className="mb-4 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div>
        <h2 className="text-sm font-semibold">
          Variants not on sale ({offSaleCount} across {data.assets.length} {data.assets.length === 1 ? "asset" : "assets"})
        </h2>
        <p className="text-xs text-muted-foreground">On Roblox with at least one recolour off sale. Tick each recolour you put on sale; an asset leaves this list when the page reloads with all of them ticked.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.assets.map((asset) => {
          const offSale = asset.links.filter((link) => !link.onSaleAt);
          return (
            <div key={asset.sku} className="space-y-1.5 rounded-md border bg-card p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium leading-snug">{asset.itemName}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {asset.sku} · {asset.links.length - offSale.length}/{asset.links.length} on sale
                  </p>
                </div>
                {offSale.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-[11px]"
                    disabled={offSale.some((link) => busy.has(link.id))}
                    onClick={() => setOnSale(asset.sku, offSale.map((link) => link.id), true)}
                  >
                    All on sale
                  </Button>
                )}
              </div>
              {asset.links.map((link, index) => (
                <label key={link.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!!link.onSaleAt}
                    disabled={busy.has(link.id)}
                    onChange={(e) => setOnSale(asset.sku, [link.id], e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="truncate text-primary hover:underline">
                    {link.variantLabel || `Link ${index + 1}`} <span className="font-mono text-muted-foreground">{link.robloxAssetId}</span>
                    <ExternalLink className="ml-1 inline h-3 w-3" />
                  </a>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
