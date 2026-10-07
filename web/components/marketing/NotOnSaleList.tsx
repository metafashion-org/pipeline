"use client";

import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";

const NOT_ON_SALE_URL = "/api/admin/marketing/not-on-sale";

interface NotOnSaleAsset {
  sku: string;
  itemName: string;
  links: { id: string; url: string; robloxAssetId: string | null; variantLabel: string | null }[];
}

/**
 * Live assets with no recolour on sale yet, each with its Roblox links. Ticking a recolour puts it
 * on sale, which moves the asset into the marketing list below. Shown to Arjun only: the list
 * route answers 403 for everyone else, and then this renders nothing.
 */
export function NotOnSaleList() {
  const router = useRouter();
  const { data, mutate } = useSWR<{ assets: NotOnSaleAsset[] }>(NOT_ON_SALE_URL, jsonFetcher, { shouldRetryOnError: false });
  const [busy, setBusy] = useState<string | null>(null);
  if (!data?.assets || data.assets.length === 0) return null;

  async function putOnSale(sku: string, linkId: string) {
    setBusy(linkId);
    try {
      const { ok, data: res } = await apiCall(`/api/assets/${encodeURIComponent(sku)}/roblox-links/${linkId}`, { method: "PATCH", body: { onSale: true } });
      if (!ok) {
        toast.error(res.error || "Couldn't put it on sale");
        return;
      }
      toast.success(`${sku} is on sale`);
      await mutate();
      // The marketing list below is server-rendered; it now includes this asset.
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-4 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div>
        <h2 className="text-sm font-semibold">Not on sale yet ({data.assets.length})</h2>
        <p className="text-xs text-muted-foreground">On Roblox but no recolour on sale. Tick the recolours you put on sale; the rest stay off sale.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.assets.map((asset) => (
          <div key={asset.sku} className="space-y-1.5 rounded-md border bg-card p-2.5 text-sm">
            <p className="font-medium leading-snug">{asset.itemName}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{asset.sku}</p>
            {asset.links.map((link, index) => (
              <label key={link.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={false} disabled={busy === link.id} onChange={() => putOnSale(asset.sku, link.id)} className="h-3.5 w-3.5 accent-primary" />
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="truncate text-primary hover:underline">
                  {link.variantLabel || `Link ${index + 1}`} <span className="font-mono text-muted-foreground">{link.robloxAssetId}</span>
                  <ExternalLink className="ml-1 inline h-3 w-3" />
                </a>
              </label>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
