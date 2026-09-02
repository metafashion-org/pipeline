"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiCall } from "@/lib/api-client";
import { formatDate } from "@/lib/format-date";
import { toast } from "sonner";
import { X, Link2 } from "lucide-react";

interface AssetOption {
  sku: string;
  id: string;
  itemName: string;
}

interface LinksState {
  skus: { linkId: string; assetId: string; sku: string; itemName: string }[];
  categories: { linkId: string; category: string }[];
  guidelines: { linkId: string; guidelineId: string; title: string }[];
  styleSystems: { linkId: string; styleSystemId: string; name: string }[];
  campaigns: { linkId: string; campaignName: string }[];
  assignments: { linkId: string; assignmentId: string; sku: string; artistName: string | null }[];
}

const EMPTY_LINKS: LinksState = { skus: [], categories: [], guidelines: [], styleSystems: [], campaigns: [], assignments: [] };

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Manages all 6 of the brief's §7 "attachable to" surfaces for one artifact
 * in one place — SKUs, categories, artist briefs (assignments), style
 * systems, marketing campaigns, technical guidelines. Before this, only
 * category had any UI at all; the other 5 either had a backend function
 * nobody called (SKU, guideline) or didn't exist as a linkable concept yet
 * (style system, campaign, assignment).
 */
export function ArtifactLinksDialog({
  open,
  onOpenChange,
  artifactId,
  artifactLabel,
  onLinksChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactId: string;
  artifactLabel: string;
  onLinksChanged?: (linkCount: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Links — {artifactLabel}</DialogTitle>
          <DialogDescription>Reuse this artifact across the pipeline instead of rewriting the same context for every asset.</DialogDescription>
        </DialogHeader>
        {open && <ArtifactLinksContent artifactId={artifactId} onLinksChanged={onLinksChanged} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArtifactLinksContent({ artifactId, onLinksChanged }: { artifactId: string; onLinksChanged?: (linkCount: number) => void }) {
  const [links, setLinks] = useState<LinksState>(EMPTY_LINKS);
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [guidelineOptions, setGuidelineOptions] = useState<{ id: string; title: string }[]>([]);
  const [styleSystemOptions, setStyleSystemOptions] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const totalLinks = links.skus.length + links.categories.length + links.guidelines.length + links.styleSystems.length + links.campaigns.length + links.assignments.length;

  async function refresh() {
    const { ok, data } = await apiCall<{ links: LinksState }>(`/api/admin/knowledge/artifacts/${artifactId}/links`);
    if (ok) {
      setLinks(data.links);
      onLinksChanged?.(
        data.links.skus.length + data.links.categories.length + data.links.guidelines.length + data.links.styleSystems.length + data.links.campaigns.length + data.links.assignments.length
      );
    }
  }

  useEffect(() => {
    // Inlined rather than calling the refresh() declared above: eslint's
    // set-state-in-effect check can confirm a fetch().then() chain written
    // directly here only touches state from inside the .then() callback,
    // but can't trace that same guarantee through a call to a separately
    // defined function, even though refresh() itself only awaits before
    // ever calling setState.
    apiCall<{ links: LinksState }>(`/api/admin/knowledge/artifacts/${artifactId}/links`)
      .then(({ data }) => {
        if (data.links) {
          setLinks(data.links);
          onLinksChanged?.(
            data.links.skus.length + data.links.categories.length + data.links.guidelines.length + data.links.styleSystems.length + data.links.campaigns.length + data.links.assignments.length
          );
        }
      })
      .catch(() => {});
    Promise.all([
      apiCall<{ data?: Array<{ assets?: Array<{ sku: string; id: string; itemName: string }> }> }>("/api/assets")
        .then(({ data: d }) => {
          const options: AssetOption[] = [];
          for (const col of d.data || []) {
            for (const a of col.assets || []) options.push({ sku: a.sku, id: a.id, itemName: a.itemName });
          }
          setAssetOptions(options);
        })
        .catch(() => {}),
      apiCall<{ guidelines?: { id: string; title: string }[] }>("/api/admin/knowledge/guidelines")
        .then(({ data: d }) => setGuidelineOptions(d.guidelines || []))
        .catch(() => {}),
      apiCall<{ styleSystems?: { id: string; name: string }[] }>("/api/admin/knowledge/style-systems")
        .then(({ data: d }) => setStyleSystemOptions(d.styleSystems || []))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId]);

  async function addLink(type: string, value: string) {
    if (!value) return;
    try {
      const { ok, data } = await apiCall<{ links: LinksState }>(`/api/admin/knowledge/artifacts/${artifactId}/links`, {
        method: "POST",
        body: { type, value },
      });
      if (!ok) throw new Error(data.error);
      setLinks(data.links);
      onLinksChanged?.(
        data.links.skus.length + data.links.categories.length + data.links.guidelines.length + data.links.styleSystems.length + data.links.campaigns.length + data.links.assignments.length
      );
      toast.success("Linked");
    } catch (e) {
      toast.error(errMessage(e, "Failed to add link"));
    }
  }

  async function removeLink(type: string, linkId: string) {
    try {
      const { ok, data } = await apiCall(`/api/admin/knowledge/artifacts/${artifactId}/links/${type}/${linkId}`, { method: "DELETE" });
      if (!ok) throw new Error(data.error);
      await refresh();
    } catch (e) {
      toast.error(errMessage(e, "Failed to remove link"));
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>;

  return (
    <div className="space-y-4 py-2">
      <LinkSection title="Individual SKUs" empty={links.skus.length === 0}>
        {links.skus.map((l) => (
          <LinkChip key={l.linkId} label={`${l.sku} — ${l.itemName}`} onRemove={() => removeLink("sku", l.linkId)} />
        ))}
      </LinkSection>
      <AssetPicker options={assetOptions} placeholder="Link a SKU..." onSelect={(assetId) => addLink("sku", assetId)} />

      <LinkSection title="Asset Categories" empty={links.categories.length === 0}>
        {links.categories.map((l) => (
          <LinkChip key={l.linkId} label={l.category} onRemove={() => removeLink("category", l.linkId)} />
        ))}
      </LinkSection>
      <TextAdder placeholder="e.g. Outerwear" onAdd={(v) => addLink("category", v)} />

      <LinkSection title="Style Systems" empty={links.styleSystems.length === 0}>
        {links.styleSystems.map((l) => (
          <LinkChip key={l.linkId} label={l.name} onRemove={() => removeLink("styleSystem", l.linkId)} />
        ))}
      </LinkSection>
      <SelectOrCreateAdder
        options={styleSystemOptions.map((s) => ({ value: s.id, label: s.name }))}
        placeholder="Link a style system..."
        createLabel="+ New style system"
        onSelect={(id) => addLink("styleSystem", id)}
        onCreate={async (name) => {
          const { ok, data } = await apiCall<{ styleSystem: { id: string; name: string } }>("/api/admin/knowledge/style-systems", {
            method: "POST",
            body: { name },
          });
          if (ok) {
            setStyleSystemOptions((prev) => [...prev, { id: data.styleSystem.id, name: data.styleSystem.name }]);
            await addLink("styleSystem", data.styleSystem.id);
          } else {
            toast.error(errMessage(new Error(data.error), "Failed to create style system"));
          }
        }}
      />

      <LinkSection title="Marketing Campaigns" empty={links.campaigns.length === 0}>
        {links.campaigns.map((l) => (
          <LinkChip key={l.linkId} label={l.campaignName} onRemove={() => removeLink("campaign", l.linkId)} />
        ))}
      </LinkSection>
      <TextAdder placeholder="e.g. Summer Drop 2026" onAdd={(v) => addLink("campaign", v)} />

      <LinkSection title="Technical Guideline Libraries" empty={links.guidelines.length === 0}>
        {links.guidelines.map((l) => (
          <LinkChip key={l.linkId} label={l.title} onRemove={() => removeLink("guideline", l.linkId)} />
        ))}
      </LinkSection>
      <SelectOrCreateAdder
        options={guidelineOptions.map((g) => ({ value: g.id, label: g.title }))}
        placeholder="Link a guideline..."
        createLabel="+ New guideline"
        onSelect={(id) => addLink("guideline", id)}
        onCreate={async (title) => {
          const { ok, data } = await apiCall<{ guideline: { id: string; title: string } }>("/api/admin/knowledge/guidelines", {
            method: "POST",
            body: { title },
          });
          if (ok) {
            setGuidelineOptions((prev) => [...prev, { id: data.guideline.id, title: data.guideline.title }]);
            await addLink("guideline", data.guideline.id);
          } else {
            toast.error(errMessage(new Error(data.error), "Failed to create guideline"));
          }
        }}
      />

      <LinkSection title="Artist Briefs" empty={links.assignments.length === 0}>
        {links.assignments.map((l) => (
          <LinkChip key={l.linkId} label={`${l.sku}${l.artistName ? ` — ${l.artistName}` : ""}`} onRemove={() => removeLink("assignment", l.linkId)} />
        ))}
      </LinkSection>
      <AssignmentAdder assetOptions={assetOptions} onSelect={(assignmentId) => addLink("assignment", assignmentId)} />

      {totalLinks === 0 && <p className="text-xs text-muted-foreground text-center">Not linked to anything yet.</p>}
    </div>
  );
}

function LinkSection({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
        <Link2 className="h-3 w-3" /> {title}
      </p>
      {!empty && <div className="flex flex-wrap gap-1.5 mb-1.5">{children}</div>}
    </div>
  );
}

function LinkChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      {label}
      <button type="button" onClick={onRemove} className="hover:text-destructive rounded-full" aria-label={`Remove ${label}`}>
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

function AssetPicker({ options, placeholder, onSelect }: { options: AssetOption[]; placeholder: string; onSelect: (assetId: string) => void }) {
  return (
    <Select value="" onValueChange={onSelect}>
      <SelectTrigger className="w-full h-8 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.sku} — {a.itemName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TextAdder({ placeholder, onAdd }: { placeholder: string; onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex gap-1.5">
      <Input
        className="h-8 text-xs"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onAdd(value.trim());
            setValue("");
          }
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs shrink-0"
        onClick={() => {
          if (value.trim()) {
            onAdd(value.trim());
            setValue("");
          }
        }}
      >
        Add
      </Button>
    </div>
  );
}

function SelectOrCreateAdder({
  options,
  placeholder,
  createLabel,
  onSelect,
  onCreate,
}: {
  options: { value: string; label: string }[];
  placeholder: string;
  createLabel: string;
  onSelect: (value: string) => void;
  onCreate: (name: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  if (creating) {
    return (
      <div className="flex gap-1.5">
        <Input
          className="h-8 text-xs"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              onCreate(newName.trim());
              setNewName("");
              setCreating(false);
            }
          }}
        />
        <Button
          size="sm"
          className="h-8 text-xs shrink-0"
          onClick={() => {
            if (newName.trim()) {
              onCreate(newName.trim());
              setNewName("");
              setCreating(false);
            }
          }}
        >
          Create
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs shrink-0" onClick={() => setCreating(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <Select value="" onValueChange={onSelect}>
        <SelectTrigger className="w-full h-8 text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" className="h-8 text-xs shrink-0 whitespace-nowrap" onClick={() => setCreating(true)}>
        {createLabel}
      </Button>
    </div>
  );
}

function AssignmentAdder({ assetOptions, onSelect }: { assetOptions: AssetOption[]; onSelect: (assignmentId: string) => void }) {
  const [assetId, setAssetId] = useState("");
  const [assignmentOptions, setAssignmentOptions] = useState<{ id: string; artistName: string | null; assignedAt: string; isActive: boolean }[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  async function onAssetChosen(id: string) {
    setAssetId(id);
    setLoadingAssignments(true);
    try {
      const { data } = await apiCall<{ assignments?: { id: string; artistName: string | null; assignedAt: string; isActive: boolean }[] }>(`/api/admin/knowledge/assignments?assetId=${encodeURIComponent(id)}`);
      setAssignmentOptions(data.assignments || []);
    } finally {
      setLoadingAssignments(false);
    }
  }

  return (
    <div className="flex gap-1.5">
      <Select value={assetId} onValueChange={onAssetChosen}>
        <SelectTrigger className="w-full h-8 text-xs">
          <SelectValue placeholder="Pick a SKU first..." />
        </SelectTrigger>
        <SelectContent>
          {assetOptions.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.sku} — {a.itemName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value=""
        onValueChange={onSelect}
        disabled={!assetId || loadingAssignments || assignmentOptions.length === 0}
      >
        <SelectTrigger className="w-full h-8 text-xs">
          <SelectValue placeholder={loadingAssignments ? "Loading..." : assetId && assignmentOptions.length === 0 ? "No assignments" : "Then pick a brief..."} />
        </SelectTrigger>
        <SelectContent>
          {assignmentOptions.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.artistName || "Unassigned"} — {formatDate(a.assignedAt)}
              {a.isActive ? " (active)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
