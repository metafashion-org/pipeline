"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ExternalLink, Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";


interface RobloxLink {
  id: string;
  url: string;
  robloxAssetId: string | null;
  variantLabel: string | null;
  onSaleAt: string | null;
}

interface LinksResponse {
  links: RobloxLink[];
  canPutOnSale: boolean;
  canAddLinks: boolean;
}

/**
 * The top of the card once an asset is on Roblox: its Roblox links, one per uploaded recolour.
 * Arjun ticks which recolours are on sale (also on the Marketing page). Uploaders add the link of a
 * recolour uploaded later. Everyone else sees the links and which are on sale.
 */
export function RobloxLinksSection({ sku, enabled }: { sku: string; enabled: boolean }) {
  const linksUrl = `/api/assets/${encodeURIComponent(sku)}/roblox-links`;
  const { data, mutate } = useSWR<LinksResponse>(enabled ? linksUrl : null, jsonFetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  if (!data) return null;
  const { links, canPutOnSale, canAddLinks } = data;
  if (links.length === 0 && !canAddLinks) return null;
  const onSaleCount = links.filter((l) => l.onSaleAt).length;

  async function toggle(link: RobloxLink) {
    setBusy(link.id);
    try {
      const { ok, data: res } = await apiCall(`${linksUrl}/${link.id}`, { method: "PATCH", body: { onSale: !link.onSaleAt } });
      if (!ok) toast.error(res.error || "Couldn't change it");
      await mutate();
    } finally {
      setBusy(null);
    }
  }

  async function addLink() {
    setBusy("add");
    try {
      const { ok, data: res } = await apiCall(linksUrl, { method: "POST", body: { url: newUrl, variantLabel: newLabel || null } });
      if (!ok) {
        toast.error(res.error || "Couldn't add the link");
        return;
      }
      toast.success("Recolour link added");
      setNewUrl("");
      setNewLabel("");
      setAdding(false);
      await mutate();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ShoppingBag className="h-3.5 w-3.5" /> Roblox links
        </h4>
        <span className="text-xs text-muted-foreground">
          {onSaleCount} of {links.length} on sale
        </span>
      </div>
      <div className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3 text-sm">
        {links.length === 0 && <p className="text-xs italic text-muted-foreground">No Roblox links yet.</p>}
        {links.map((link, index) => (
          <div key={link.id} className="flex items-center gap-2">
            {canPutOnSale ? (
              <input
                type="checkbox"
                checked={Boolean(link.onSaleAt)}
                disabled={busy === link.id}
                onChange={() => toggle(link)}
                className="h-4 w-4 shrink-0 accent-primary"
                aria-label={`${link.variantLabel || `Link ${index + 1}`} on sale`}
              />
            ) : null}
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">
              {link.variantLabel || `Link ${index + 1}`}
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">{link.robloxAssetId}</span>
              <ExternalLink className="ml-1 inline h-3 w-3" />
            </a>
            {link.onSaleAt ? (
              <Badge variant="secondary" className="shrink-0 font-normal">
                On sale {formatDate(link.onSaleAt)}
              </Badge>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">Not on sale</span>
            )}
          </div>
        ))}

        {canAddLinks &&
          (adding ? (
            <div className="grid gap-2 border-t border-border/60 pt-2 sm:grid-cols-[1fr_120px_auto]">
              <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Roblox catalog link of the new recolour" className="h-8 text-xs" />
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Recolour, e.g. Red" className="h-8 text-xs" />
              <Button size="sm" className="h-8 text-xs" disabled={!newUrl.trim() || busy === "add"} onClick={addLink}>
                {busy === "add" ? "Adding..." : "Add"}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setAdding(true)}>
              <Plus className="h-3 w-3" /> Add recolour link
            </Button>
          ))}
      </div>
    </section>
  );
}
