"use client";

import { useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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
import { Switch } from "@/components/ui/switch";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format-date";

const COMMON_PLATFORMS = ["Pinterest", "Instagram", "TikTok", "YouTube Shorts", "Twitter/X"];
const COMMON_POST_TYPES = ["Reel", "Story", "Carousel", "Video", "Static Post"];

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  done: "default",
  posted: "default",
  boosted_promoted: "default",
  needs_repost: "destructive",
  scheduled: "secondary",
  planned: "secondary",
  creative_needed: "secondary",
};

const cardClass = "shadow-sm hover:shadow-md transition-shadow";

export interface MarketingUpdateRow {
  updateId: string;
  assetId: string;
  sku: string;
  itemName: string;
  campaign: string | null;
  platform: string;
  postType: string | null;
  postUrl: string | null;
  creative: string | null;
  caption: string | null;
  marketingStatus: string;
  postedAt: string | null;
  highPerforming: boolean;
  notes: string | null;
  nextAction: string | null;
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
    // highPerforming is a real flag independent of lifecycle status - see marketing_updates.ts.
    if (quickFilter === "high_performing") return updates.filter((u) => u.highPerforming);
    return updates;
  }, [updates, quickFilter]);

  const updatesByStatus = useMemo(() => {
    const map = new Map<string, MarketingUpdateRow[]>();
    for (const u of visibleUpdates) {
      const list = map.get(u.marketingStatus);
      if (list) list.push(u);
      else map.set(u.marketingStatus, [u]);
    }
    return map;
  }, [visibleUpdates]);

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
      {/* The toolbar filters and switches views, so it only exists once something has been logged. Until then the empty state below carries the single call to action. */}
      {updates.length > 0 && (
      <div className="flex items-center justify-between gap-3 bg-muted/40 p-3 rounded-lg text-sm shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-1">Filter</span>
              <Badge
                variant={quickFilter === "postedThisWeek" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleQuickFilter("postedThisWeek")}
              >
                Posted this week
              </Badge>
              <Badge
                variant={quickFilter === "needs_repost" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleQuickFilter("needs_repost")}
              >
                Needs repost
              </Badge>
              <Badge
                variant={quickFilter === "high_performing" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleQuickFilter("high_performing")}
              >
                High performing
              </Badge>
              {quickFilter && (
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setQuickFilter(null)}>
                  Clear
                </Button>
              )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground">
            {visibleUpdates.length} of {updates.length} posts
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant={view === "status" ? "default" : "outline"} onClick={() => setView("status")}>
              By status
            </Button>
            <Button size="sm" variant={view === "asset" ? "default" : "outline"} onClick={() => setView("asset")}>
              By asset
            </Button>
          </div>
          <Button size="sm" onClick={() => openLogDialog()}>
            Log marketing activity
          </Button>
        </div>
      </div>
      )}

      {/* The queue of assets that are live on Roblox but have no marketing yet. This is the actual to-do list for this page, so it is a list of rows with an action on each rather than a filter toggle hiding a row of badges. */}
      {unmarketedAssets.length > 0 && (
        <Card className={cardClass + " shrink-0"}>
          <CardHeader className={showUnmarketed ? "pb-3" : "py-3"}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                Waiting on marketing
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {unmarketedAssets.length} uploaded to Roblox with nothing posted yet
                </span>
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs"
                onClick={() => setShowUnmarketed((v) => !v)}
                aria-expanded={showUnmarketed}
              >
                {showUnmarketed ? "Hide" : "Show"}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showUnmarketed ? "rotate-180" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          {showUnmarketed && (
            <CardContent className="pt-0">
              {/* Capped so a long queue scrolls inside the card instead of pushing the logged activity off screen. */}
              <div className="divide-y max-h-64 overflow-y-auto">
                {unmarketedAssets.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{a.itemName}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {a.sku}
                        {a.category ? ` - ${a.category}` : ""}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => openLogDialog(a.sku)}>
                      Log activity
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {visibleUpdates.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center">
          {updates.length === 0 ? (
            <>
              <p className="text-sm font-medium">No marketing activity logged yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Every post, platform and link recorded here is tied to an asset. Start with one of the assets waiting above.
              </p>
              <Button size="sm" className="mt-1" onClick={() => openLogDialog()}>
                Log marketing activity
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Nothing matches this filter</p>
              <Button size="sm" variant="outline" className="mt-1" onClick={() => setQuickFilter(null)}>
                Clear filter
              </Button>
            </>
          )}
        </div>
      ) : view === "status" ? (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
          {statusColumns.map((col) => {
            const colUpdates = updatesByStatus.get(col.statusKey) || [];
            return (
            <Card key={col.id} className={cardClass + " shrink-0 w-[280px] flex flex-col"}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs uppercase tracking-wider">{col.label}</CardTitle>
                  <Badge variant="secondary">
                    {colUpdates.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto space-y-2">
                {colUpdates
                  .map((update) => (
                    <div key={update.updateId} className="p-2.5 bg-background border rounded-md text-xs space-y-1 shadow-sm">
                      <div className="flex justify-between font-mono font-bold">
                        <span>{update.sku}</span>
                        <span className="uppercase text-[10px] text-muted-foreground">
                          {update.platform}
                          {update.postType ? ` · ${update.postType}` : ""}
                        </span>
                      </div>
                      <p className="font-medium text-foreground">{update.itemName}</p>
                      {update.campaign && <p className="text-muted-foreground truncate">Campaign: {update.campaign}</p>}
                      {update.caption && <p className="text-muted-foreground italic truncate">{update.caption}</p>}
                      {update.highPerforming && (
                        <Badge variant="default" className="text-[9px] h-4 px-1.5">High performing</Badge>
                      )}
                    </div>
                  ))}
              </CardContent>
            </Card>
            );
          })}
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
                      <TableHead>Platform / Type</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Link</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Posted</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.updates.map((u) => (
                      <TableRow key={u.updateId}>
                        <TableCell className="font-medium">
                          {u.platform}
                          {u.postType && <span className="text-muted-foreground font-normal"> · {u.postType}</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{u.campaign || "-"}</TableCell>
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
                          <div className="flex items-center gap-1 flex-wrap">
                            <Badge variant={STATUS_VARIANT[u.marketingStatus] || "outline"}>
                              {statusLabel(u.marketingStatus)}
                            </Badge>
                            {u.highPerforming && <Badge variant="outline" className="text-[10px]">High performing</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(u.postedAt)}
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
  const [campaign, setCampaign] = useState("");
  const [platform, setPlatform] = useState("");
  const [postType, setPostType] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [creative, setCreative] = useState("");
  const [postedAt, setPostedAt] = useState("");
  const [marketingStatus, setMarketingStatus] = useState("");
  const [highPerforming, setHighPerforming] = useState(false);
  const [caption, setCaption] = useState("");
  const [notes, setNotes] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Adjusted during render on the open transition rather than in an effect
  // (React's own recommended pattern for "reset state when a prop changes")
  // - avoids the extra render an effect-based setState would otherwise
  // trigger every time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSku(initialSku);
  }

  const assetNameBySku = useMemo(() => new Map(assetOptions.map((a) => [a.sku, a.itemName])), [assetOptions]);

  function reset() {
    setSku(null);
    setCampaign("");
    setPlatform("");
    setPostType("");
    setPostUrl("");
    setCreative("");
    setPostedAt("");
    setMarketingStatus("");
    setHighPerforming(false);
    setCaption("");
    setNotes("");
    setNextAction("");
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
          campaign: campaign.trim() || undefined,
          platform: platform.trim(),
          postType: postType.trim() || undefined,
          postUrl: postUrl.trim(),
          creative: creative.trim() || undefined,
          postedAt: postedAt || undefined,
          marketingStatus: marketingStatus || undefined,
          highPerforming,
          caption: caption.trim() || undefined,
          notes: notes.trim() || undefined,
          nextAction: nextAction.trim() || undefined,
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
        campaign: data.update.campaign,
        platform: data.update.platform,
        postType: data.update.postType,
        postUrl: data.update.postUrl,
        creative: data.update.creative,
        caption: data.update.caption,
        marketingStatus: data.update.marketingStatus,
        postedAt: data.update.postedAt,
        highPerforming: data.update.highPerforming,
        notes: data.update.notes,
        nextAction: data.update.nextAction,
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
            <Label>
              Asset<span className="text-destructive"> *</span>
            </Label>
            <Combobox
              value={sku}
              onValueChange={setSku}
              itemToStringLabel={(value) => assetNameBySku.get(value as string) ?? (value as string)}
            >
              <ComboboxInput placeholder="Select an asset..." />
              <ComboboxContent>
                <ComboboxList>
                  <ComboboxEmpty>No assets found.</ComboboxEmpty>
                  {assetOptions.map((a) => (
                    <ComboboxItem key={a.sku} value={a.sku}>
                      <div className="flex flex-col">
                        <span>{a.itemName}</span>
                        <span className="text-xs text-muted-foreground font-mono">{a.sku}</span>
                      </div>
                    </ComboboxItem>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="platform-input">
                Platform<span className="text-destructive"> *</span>
              </Label>
              <div className="flex gap-1.5 flex-wrap mt-1 mb-1.5">
                {/* Real buttons, not clickable spans, so the quick picks are reachable by keyboard like every other control in the form. */}
                {COMMON_PLATFORMS.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant={platform === p ? "default" : "outline"}
                    className="h-7 rounded-full px-3 text-xs font-normal"
                    aria-pressed={platform === p}
                    onClick={() => setPlatform(p)}
                  >
                    {p}
                  </Button>
                ))}
              </div>
              <Input
                id="platform-input"
                placeholder="Or type another platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="posttype-input">Post / channel type</Label>
              <div className="flex gap-1.5 flex-wrap mt-1 mb-1.5">
                {COMMON_POST_TYPES.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant={postType === p ? "default" : "outline"}
                    className="h-7 rounded-full px-3 text-xs font-normal"
                    aria-pressed={postType === p}
                    onClick={() => setPostType(p)}
                  >
                    {p}
                  </Button>
                ))}
              </div>
              <Input
                id="posttype-input"
                placeholder="Or type another type"
                value={postType}
                onChange={(e) => setPostType(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="campaign-input">Campaign</Label>
              <Input id="campaign-input" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. Summer drop" />
            </div>
            <div>
              <Label htmlFor="creative-input">Creative used</Label>
              <Input id="creative-input" value={creative} onChange={(e) => setCreative(e.target.value)} placeholder="Which asset/creative" />
            </div>
          </div>
          <div>
            <Label htmlFor="posturl-input">Post URL</Label>
            <Input
              id="posturl-input"
              type="url"
              placeholder="https://..."
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="postedat-input">Posted date</Label>
              <Input
                id="postedat-input"
                type="date"
                value={postedAt}
                onChange={(e) => setPostedAt(e.target.value)}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={marketingStatus} onValueChange={setMarketingStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Set automatically from whether a link is present" />
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
          </div>
          <div>
            <Label htmlFor="caption-input">Caption / angle</Label>
            <Textarea id="caption-input" rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="nextaction-input">Next marketing action</Label>
            <Input id="nextaction-input" value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="e.g. Repost with new creative next Tuesday" />
          </div>
          <div>
            <Label htmlFor="notes-input">Notes</Label>
            <Textarea id="notes-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label htmlFor="highperforming-toggle">High performing</Label>
              {/* A judgment call about performance, independent of the lifecycle status above — see marketing_updates.ts. */}
              <p className="text-xs text-muted-foreground">Flags it for the &ldquo;High performing&rdquo; filter, regardless of status.</p>
            </div>
            <Switch id="highperforming-toggle" checked={highPerforming} onCheckedChange={setHighPerforming} />
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
