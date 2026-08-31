"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PackageCheck, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/format-date";

interface QueueItem {
  id: string;
  sku: string;
  itemName: string;
  category: string | null;
  deadline: string | null;
  artistName: string | null;
  updatedAt: string;
}

function QueueCard({ item, onPublished }: { item: QueueItem; onPublished: (id: string) => void }) {
  const [robloxItemUrl, setRobloxItemUrl] = useState("");
  const [robloxAssetId, setRobloxAssetId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!robloxItemUrl.trim()) {
      toast.error("A Roblox item URL is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(item.sku)}/roblox-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          robloxItemUrl: robloxItemUrl.trim(),
          robloxAssetId: robloxAssetId.trim() || undefined,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error || "Failed to record Roblox upload");
        return;
      }
      toast.success(`${item.sku} — published to Roblox Marketplace`);
      onPublished(item.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
          <p className="font-semibold truncate">{item.itemName}</p>
          <p className="text-xs text-muted-foreground">
            {item.category || "Uncategorised"} · Artist: {item.artistName || "-"} · Deadline: {formatDate(item.deadline, "Not set")}
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto] items-end">
        <div className="grid gap-1">
          <Label htmlFor={`roblox-url-${item.id}`} className="text-xs">Roblox item URL</Label>
          <Input
            id={`roblox-url-${item.id}`}
            value={robloxItemUrl}
            onChange={(e) => setRobloxItemUrl(e.target.value)}
            placeholder="https://www.roblox.com/catalog/..."
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`roblox-id-${item.id}`} className="text-xs">Roblox asset ID (optional)</Label>
          <Input id={`roblox-id-${item.id}`} value={robloxAssetId} onChange={(e) => setRobloxAssetId(e.target.value)} placeholder="123456789" />
        </div>
        <Button size="sm" onClick={submit} disabled={submitting} data-testid={`publish-${item.sku}`}>
          <PackageCheck className="h-3.5 w-3.5" />
          {submitting ? "Publishing..." : "Publish"}
        </Button>
      </div>
    </div>
  );
}

export function PublisherQueue({ initialItems }: { initialItems: QueueItem[] }) {
  const [items, setItems] = useState(initialItems);

  const handlePublished = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center text-sm text-muted-foreground py-16">
        <PackageCheck className="h-8 w-8 mx-auto mb-3 opacity-50" />
        Nothing waiting for upload right now. Assets land here once an operator notifies the uploader after final files are received.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <ExternalLink className="h-3 w-3" /> {items.length} asset{items.length === 1 ? "" : "s"} ready for upload
      </p>
      {items.map((item) => (
        <QueueCard key={item.id} item={item} onPublished={handlePublished} />
      ))}
    </div>
  );
}
