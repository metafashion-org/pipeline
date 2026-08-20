"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { toast } from "sonner";

const COMMON_PLATFORMS = ["Pinterest", "Instagram", "TikTok", "YouTube Shorts", "Twitter/X"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  posted: "default",
  high_performing: "default",
  needs_repost: "destructive",
  rejected: "destructive",
  scheduled: "secondary",
  creative_in_progress: "secondary",
};

const cardClass = "shadow-sm hover:shadow-md transition-all";

export interface MarketingUpdateRow {
  updateId: string;
  assetId: string;
  sku: string;
  itemName: string;
  platform: string;
  postUrl: string | null;
  caption: string | null;
  marketingStatus: string;
  postedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface StatusColumn {
  id: string;
  statusKey: string;
  label: string;
}

export interface UnmarketedAsset {
  id: string;
  sku: string;
  itemName: string;
  category: string | null;
  currentStatus: string;
}

type QuickFilter = "postedThisWeek" | "needs_repost" | "high_performing" | null;

function isPostedThisWeek(update: MarketingUpdateRow): boolean {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return update.marketingStatus === "posted" && new Date(update.createdAt) >= sevenDaysAgo;
}

export function MarketingTracker({
  statusColumns,
  initialUpdates,
  unmarketedAssets,
}: {
  statusColumns: StatusColumn[];
  initialUpdates: MarketingUpdateRow[];
  unmarketedAssets: UnmarketedAsset[];
}) {
  const [updates, setUpdates] = useState(initialUpdates);
  const [view, setView] = useState<"status" | "asset">("status");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [showUnmarketed, setShowUnmarketed] = useState(false);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [logDialogSku, setLogDialogSku] = useState<string | null>(null);

  function openLogDialog(sku?: string) {
    setLogDialogSku(sku ?? null);
    setLogDialogOpen(true);
  }

  const assetOptions = useMemo(() => {
    const bySku = new Map<string, string>();
    for (const a of unmarketedAssets) bySku.set(a.sku, a.itemName);
    for (const u of updates) if (!bySku.has(u.sku)) bySku.set(u.sku, u.itemName);
    return Array.from(bySku.entries()).map(([sku, itemName]) => ({ sku, itemName }));
  }, [unmarketedAssets, updates]);

  const statusLabel = useMemo(() => {
    const map = new Map(statusColumns.map((c) => [c.statusKey, c.label]));
    return (key: string) => map.get(key) || key;
  }, [statusColumns]);

  const visibleUpdates = useMemo(() => {
    if (quickFilter === "postedThisWeek") return updates.filter(isPostedThisWeek);
    if (quickFilter === "needs_repost") return updates.filter((u) => u.marketingStatus === "needs_repost");
    if (quickFilter === "high_performing") return updates.filter((u) => u.marketingStatus === "high_performing");
    return updates;
  }, [updates, quickFilter]);

  const assetGroups = useMemo(() => {
    const groups = new Map<string, { sku: string; itemName: string; updates: MarketingUpdateRow[] }>();
    for (const u of visibleUpdates) {
      const existing = groups.get(u.assetId);
      if (existing) existing.updates.push(u);
      else groups.set(u.assetId, { sku: u.sku, itemName: u.itemName, updates: [u] });
    }
    return Array.from(groups.entries()).map(([assetId, group]) => ({ assetId, ...group }));
  }, [visibleUpdates]);

  function toggleQuickFilter(filter: QuickFilter) {
    setQuickFilter((prev) => (prev === filter ? null : filter));
  }

  function onUpdateAdded(newUpdate: MarketingUpdateRow) {
    setUpdates((prev) => [newUpdate, ...prev]);
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-hidden">
      <div className="flex items-center justify-between bg-muted/40 p-3 rounded-lg text-sm shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold mr-1">Quick Filters:</span>
          <Badge
            variant={showUnmarketed ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setShowUnmarketed((v) => !v)}
          >
            Uploaded Not Marketed ({unmarketedAssets.length})
          </Badge>
          <Badge
            variant={quickFilter === "postedThisWeek" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => toggleQuickFilter("postedThisWeek")}
          >
            Posted This Week
          </Badge>
          <Badge
            variant={quickFilter === "needs_repost" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => toggleQuickFilter("needs_repost")}
          >
            Needs Repost
          </Badge>
          <Badge
            variant={quickFilter === "high_performing" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => toggleQuickFilter("high_performing")}
          >
            High Performing
          </Badge>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground">
            Showing {visibleUpdates.length} of {updates.length} campaign logs
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant={view === "status" ? "default" : "outline"} onClick={() => setView("status")}>
              By Status
            </Button>
            <Button size="sm" variant={view === "asset" ? "default" : "outline"} onClick={() => setView("asset")}>
              By Asset
            </Button>
          </div>
          <Button size="sm" onClick={() => openLogDialog()}>
            Log marketing activity
          </Button>
        </div>
      </div>

      {showUnmarketed && (
        <Card className={cardClass + " shrink-0"}>
          <CardHeader>
            <CardTitle className="text-sm">Uploaded, Not Yet Marketed</CardTitle>
          </CardHeader>
          <CardContent>
            {unmarketedAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing waiting on marketing right now.</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {unmarketedAssets.map((a) => (
                  <Badge
                    key={a.id}
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => openLogDialog(a.sku)}
                  >
                    {a.sku} - {a.itemName}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {visibleUpdates.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          No marketing updates match the current filters.
        </div>
      ) : view === "status" ? (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
          {statusColumns.map((col) => (
            <Card key={col.id} className={cardClass + " shrink-0 w-[280px] flex flex-col"}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs uppercase tracking-wider">{col.label}</CardTitle>
                  <Badge variant="secondary">
                    {visibleUpdates.filter((u) => u.marketingStatus === col.statusKey).length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto space-y-2">
                {visibleUpdates
                  .filter((u) => u.marketingStatus === col.statusKey)
                  .map((update) => (
                    <div key={update.updateId} className="p-2.5 bg-background border rounded-md text-xs space-y-1 shadow-sm">
                      <div className="flex justify-between font-mono font-bold">
                        <span>{update.sku}</span>
                        <span className="uppercase text-[10px] text-muted-foreground">{update.platform}</span>
                      </div>
                      <p className="font-medium text-foreground">{update.itemName}</p>
                      {update.caption && <p className="text-muted-foreground italic truncate">{update.caption}</p>}
                    </div>
                  ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-4">
          {assetGroups.map((group) => (
            <Card key={group.assetId} className={cardClass}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    <span className="font-mono">{group.sku}</span> - {group.itemName}
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={() => openLogDialog(group.sku)}>
                    + Platform
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead>Link</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Posted</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.updates.map((u) => (
                      <TableRow key={u.updateId}>
                        <TableCell className="font-medium">{u.platform}</TableCell>
                        <TableCell>
                          {u.postUrl ? (
                            <a
                              href={u.postUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline underline-offset-4"
                            >
                              View post
                            </a>
                          ) : (
                            <span className="text-muted-foreground">Not linked yet</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[u.marketingStatus] || "outline"}>
                            {statusLabel(u.marketingStatus)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {u.postedAt ? new Date(u.postedAt).toLocaleDateString() : "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                          {u.notes || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <LogMarketingDialog
        open={logDialogOpen}
        onOpenChange={setLogDialogOpen}
        initialSku={logDialogSku}
        assetOptions={assetOptions}
        statusColumns={statusColumns}
        onAdded={onUpdateAdded}
      />
    </div>
  );
}

function LogMarketingDialog({
  open,
  onOpenChange,
  initialSku,
  assetOptions,
  statusColumns,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSku: string | null;
  assetOptions: { sku: string; itemName: string }[];
  statusColumns: StatusColumn[];
  onAdded: (update: MarketingUpdateRow) => void;
}) {
  const [sku, setSku] = useState<string | null>(null);
  const [platform, setPlatform] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [postedAt, setPostedAt] = useState("");
  const [marketingStatus, setMarketingStatus] = useState("");
  const [caption, setCaption] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setSku(initialSku);
  }, [open, initialSku]);

  function reset() {
    setSku(null);
    setPlatform("");
    setPostUrl("");
    setPostedAt("");
    setMarketingStatus("");
    setCaption("");
    setNotes("");
  }

  async function submit() {
    if (!sku) {
      toast.error("Select an asset");
      return;
    }
    if (!platform.trim()) {
      toast.error("Platform is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/marketing/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          platform: platform.trim(),
          postUrl: postUrl.trim(),
          postedAt: postedAt || undefined,
          marketingStatus: marketingStatus || undefined,
          caption: caption.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to log marketing activity");
        return;
      }
      const asset = assetOptions.find((a) => a.sku === sku);
      onAdded({
        updateId: data.update.id,
        assetId: data.update.assetId,
        sku,
        itemName: asset?.itemName || sku,
        platform: data.update.platform,
        postUrl: data.update.postUrl,
        caption: data.update.caption,
        marketingStatus: data.update.marketingStatus,
        postedAt: data.update.postedAt,
        notes: data.update.notes,
        createdAt: data.update.createdAt,
      });
      toast.success(`${platform} logged for ${sku}`);
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log marketing activity</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Asset</Label>
            <Combobox value={sku} onValueChange={setSku}>
              <ComboboxInput placeholder="Select an asset..." />
              <ComboboxContent>
                <ComboboxList>
                  <ComboboxEmpty>No assets found.</ComboboxEmpty>
                  {assetOptions.map((a) => (
                    <ComboboxItem key={a.sku} value={a.sku}>
                      {a.sku} - {a.itemName}
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <div>
            <Label htmlFor="platform-input">Platform</Label>
            <Input
              id="platform-input"
              list="platform-suggestions"
              placeholder="Pinterest, Instagram, ..."
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            />
            <datalist id="platform-suggestions">
              {COMMON_PLATFORMS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="posturl-input">Post URL (optional)</Label>
            <Input
              id="posturl-input"
              type="url"
              placeholder="https://..."
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="postedat-input">Posted date (optional)</Label>
            <Input
              id="postedat-input"
              type="date"
              value={postedAt}
              onChange={(e) => setPostedAt(e.target.value)}
            />
          </div>
          <div>
            <Label>Status (optional)</Label>
            <Select value={marketingStatus} onValueChange={setMarketingStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Auto (based on post URL)" />
              </SelectTrigger>
              <SelectContent>
                {statusColumns.map((c) => (
                  <SelectItem key={c.statusKey} value={c.statusKey}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="caption-input">Caption (optional)</Label>
            <Input id="caption-input" value={caption} onChange={(e) => setCaption(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="notes-input">Notes (optional)</Label>
            <Input id="notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Logging..." : "Log activity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
