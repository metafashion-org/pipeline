"use client";

import { useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetcher";
import { toast } from "sonner";
import { ExternalLink, BookOpen, Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LinkedArtifact {
  linkId: string;
  id: string;
  artifactId: string;
  title: string;
  typeLabel: string;
  fileUrl: string | null;
  usageNotes: string | null;
}

interface RegistryArtifact {
  id: string;
  artifactId: string;
  title: string;
  typeLabel: string;
}

/**
 * The other end of the Knowledge Registry's SKU-linking (see ArtifactLinksDialog.tsx, which
 * links from the artifact's side). The brief's §7 whole point — "reuse knowledge instead of
 * rewriting context for every asset" — only actually happens if someone looking at an asset can
 * see what's linked to it, and can attach one without leaving the drawer to go hunt through the
 * Knowledge Registry's own admin page. Loads only when the drawer opens, same as AssetHistory.
 *
 * Attaching/removing reuses the same endpoints ArtifactLinksDialog already calls
 * (POST/DELETE .../links), so there's one source of truth for a SKU link, not two.
 */
export function LinkedArtifacts({
  sku,
  assetId,
  enabled,
  canManage,
}: {
  sku: string;
  /** The asset's own row id, not the SKU string — this is what artifact_sku_links.asset_id
   *  actually stores (see linkArtifactToSku's signature). */
  assetId: string;
  enabled: boolean;
  canManage: boolean;
}) {
  const linksKey = enabled ? `/api/assets/${encodeURIComponent(sku)}/artifacts` : null;
  const { data, isLoading, mutate } = useSWR<{ artifacts: LinkedArtifact[] }>(linksKey, jsonFetcher);
  const artifacts = data?.artifacts || [];

  const [attaching, setAttaching] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Only fetched once the attach picker is actually opened — no reason to load the whole
  // registry every time someone opens an asset that doesn't need a new link right now.
  const { data: registryData } = useSWR<{ artifacts: RegistryArtifact[] }>(
    canManage && attaching ? "/api/admin/knowledge/artifacts" : null,
    jsonFetcher
  );
  const linkedIds = new Set(artifacts.map((a) => a.id));
  const attachOptions = (registryData?.artifacts || []).filter((a) => !linkedIds.has(a.id));

  async function attach() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/knowledge/artifacts/${selected}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "sku", value: assetId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to attach artifact");
      toast.success("Artifact attached");
      setSelected("");
      setAttaching(false);
      mutate();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to attach artifact");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(a: LinkedArtifact) {
    try {
      const res = await fetch(`/api/admin/knowledge/artifacts/${a.id}/links/sku/${a.linkId}`, {
        method: "DELETE",
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "Failed to remove artifact");
      toast.success("Artifact removed");
      mutate();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to remove artifact");
    }
  }

  // Someone who can't manage links and has nothing linked has no action to take here, so the
  // section stays hidden for them, same as before. A manager sees it (and the Attach control)
  // even empty — otherwise the feature is undiscoverable, since nothing else on the page hints
  // it exists.
  if (!isLoading && artifacts.length === 0 && !canManage) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" /> Linked Knowledge
        </h4>
        {canManage && !attaching && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={() => setAttaching(true)}
          >
            <Plus className="h-3 w-3" /> Attach
          </Button>
        )}
      </div>
      <div className="bg-muted/30 p-3 rounded-md text-sm space-y-2">
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && artifacts.length === 0 && !attaching && (
          <p className="text-xs text-muted-foreground italic">Nothing linked yet.</p>
        )}
        {artifacts.map((a) => (
          <div key={a.linkId} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-xs text-muted-foreground">
                {a.artifactId} · {a.typeLabel}
              </p>
              <p className="truncate">{a.title}</p>
              {a.usageNotes && <p className="text-xs text-muted-foreground truncate">{a.usageNotes}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {a.fileUrl && (
                <a
                  href={a.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                  title="Open"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => remove(a)}
                  title="Remove from this asset"
                  aria-label={`Remove ${a.title} from this asset`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}

        {attaching && (
          <div className="flex items-center gap-2 pt-2 mt-1 border-t border-border/60">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder={attachOptions.length ? "Pick an artifact…" : "Nothing left to attach"} />
              </SelectTrigger>
              <SelectContent>
                {attachOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.artifactId} · {a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 text-xs" disabled={!selected || submitting} onClick={attach}>
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setAttaching(false);
                setSelected("");
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
