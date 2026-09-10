"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PackageCheck, ExternalLink, Plus, X, AlertCircle } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import { apiCall } from "@/lib/api-client";
import { parseRobloxLinkLines, splitRobloxLinkText } from "@/lib/publisher/roblox-links";

interface QueueItem {
  id: string;
  sku: string;
  itemName: string;
  category: string | null;
  deadline: string | null;
  artistName: string | null;
  updatedAt: string;
}

interface LinkEntry {
  // Stable across re-renders so React keeps the right row when one in the middle is removed. The line number can't do that job because it shifts.
  key: string;
  raw: string;
}

// What one row in the list resolves to: either a link with its catalog id read out of it, or a reason it did not validate.
type ResolvedEntry =
  | { key: string; line: number; raw: string; ok: true; url: string; assetId: string; slug: string | null }
  | { key: string; line: number; raw: string; ok: false; reason: string };

let entryCounter = 0;
const nextEntryKey = () => `link-${++entryCounter}`;

function QueueCard({ item, onPublished }: { item: QueueItem; onPublished: (id: string) => void }) {
  const [entries, setEntries] = useState<LinkEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // One pass over every line, so duplicate detection sees the whole list rather than each line on its own. Line numbers here are the same ones the API reports back on a rejection, because both sides run this function over the same array in the same order.
  const resolved = useMemo<ResolvedEntry[]>(() => {
    const { valid, invalid } = parseRobloxLinkLines(entries.map((e) => e.raw));
    const byLine = new Map<number, ResolvedEntry>();
    for (const v of valid) {
      byLine.set(v.line, { key: entries[v.line - 1].key, line: v.line, raw: v.raw, ok: true, url: v.url, assetId: v.assetId, slug: v.slug });
    }
    for (const i of invalid) {
      byLine.set(i.line, { key: entries[i.line - 1].key, line: i.line, raw: i.raw, ok: false, reason: i.reason });
    }
    return entries.map((e, index) => byLine.get(index + 1) ?? { key: e.key, line: index + 1, raw: e.raw, ok: false as const, reason: "Empty line." });
  }, [entries]);

  const validCount = resolved.filter((r) => r.ok).length;
  const invalidCount = resolved.length - validCount;

  // Pasting a block of links adds one entry per line rather than one entry holding the whole block, so per-line validation still applies to a paste.
  function addDraft() {
    const lines = splitRobloxLinkText(draft);
    if (lines.length === 0) return;
    setEntries((prev) => [...prev, ...lines.map((raw) => ({ key: nextEntryKey(), raw }))]);
    setDraft("");
  }

  function removeEntry(key: string) {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }

  async function submit() {
    if (invalidCount > 0) {
      toast.error(`Fix ${invalidCount} link${invalidCount === 1 ? "" : "s"} before submitting`);
      return;
    }
    if (validCount === 0) {
      toast.error("Add at least one Roblox link");
      return;
    }
    setSubmitting(true);
    try {
      const { ok, data } = await apiCall<{ invalidLines?: { line: number; reason: string }[] }>(
        `/api/assets/${encodeURIComponent(item.sku)}/roblox-upload`,
        { method: "POST", body: { robloxItemUrls: entries.map((e) => e.raw) } }
      );
      if (!ok) {
        // The server re-validates, so it can reject lines the browser accepted (a rule changed, an older tab). Naming the lines keeps the message actionable instead of a bare failure.
        const detail = data.invalidLines?.map((l) => `line ${l.line}: ${l.reason}`).join("; ");
        toast.error(detail ? `${data.error} ${detail}` : data.error || "Failed to record Roblox upload");
        return;
      }
      toast.success(`${item.sku} — ${validCount} link${validCount === 1 ? "" : "s"} published to Roblox Marketplace`);
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

      <div className="grid gap-1">
        <Label htmlFor={`roblox-url-${item.id}`} className="text-xs">
          Roblox item links — one per line
        </Label>
        <div className="flex gap-2">
          <Input
            id={`roblox-url-${item.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Otherwise Enter submits the surrounding form and the queue navigates away mid-entry.
                e.preventDefault();
                addDraft();
              }
            }}
            placeholder="https://www.roblox.com/catalog/116109904627748/Birthday-Time-Fedora"
            data-testid={`roblox-link-input-${item.sku}`}
          />
          <Button type="button" size="sm" variant="outline" onClick={addDraft} disabled={!draft.trim()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Press Enter to add each link, then submit them together.</p>
      </div>

      {resolved.length > 0 && (
        <ul className="space-y-1" data-testid={`roblox-link-list-${item.sku}`}>
          {resolved.map((entry) => (
            <li
              key={entry.key}
              className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${
                entry.ok ? "border-border bg-muted/40" : "border-destructive/40 bg-destructive/10"
              }`}
            >
              <span className="font-mono text-muted-foreground w-5 shrink-0 pt-0.5">{entry.line}.</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono">{entry.raw}</p>
                {entry.ok ? (
                  <p className="text-muted-foreground">
                    Asset ID {entry.assetId}
                    {entry.slug ? ` · ${entry.slug.replace(/-/g, " ")}` : ""}
                  </p>
                ) : (
                  <p className="text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" /> {entry.reason}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeEntry(entry.key)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label={`Remove link on line ${entry.line}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {validCount} valid{invalidCount > 0 ? ` · ${invalidCount} to fix` : ""}
        </p>
        <Button
          size="sm"
          onClick={submit}
          disabled={submitting || validCount === 0 || invalidCount > 0}
          data-testid={`publish-${item.sku}`}
        >
          <PackageCheck className="h-3.5 w-3.5" />
          {submitting ? "Publishing..." : `Submit ${validCount || ""} link${validCount === 1 ? "" : "s"}`.trim()}
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
