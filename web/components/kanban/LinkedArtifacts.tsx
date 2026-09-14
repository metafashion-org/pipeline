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
 * Same status-check-before-parse shape as lib/fetcher.ts's jsonFetcher, for POST/DELETE instead
 * of GET (jsonFetcher takes no RequestInit, so it doesn't fit here as-is). Checking `res.ok`
 * before trusting the body avoids two different failure modes: reading an error payload as if it
 * were the real result, and a non-JSON error page throwing an opaque parse error instead of a
 * useful message.
 */
async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error || `Request failed with ${res.status}`);
  }
  return res.json().catch(() => null) as Promise<T>;
}

/**
 * The Select + Add/Cancel row shown while attaching an artifact — split out of LinkedArtifacts so
 * its own state (selection, submitting, the registry fetch) doesn't add to that function's
 * control-flow complexity. Fetches the registry on mount rather than being gated by a prop: it
 * only ever mounts while the parent is in "attaching" mode, so mounting already is the gate.
 */
function AttachArtifactControl({
  linkedIds,
  onAttach,
  onCancel,
}: {
  linkedIds: Set<string>;
  onAttach: (artifactId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { data } = useSWR<{ artifacts: RegistryArtifact[] }>("/api/admin/knowledge/artifacts", jsonFetcher);
  const options = (data?.artifacts || []).filter((a) => !linkedIds.has(a.id));

  const [selected, setSelected] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAttach() {
    if (!selected) return;
    setSubmitting(true);
    try {
      await onAttach(selected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 pt-2 mt-1 border-t border-border/60">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="h-8 text-xs flex-1">
          <SelectValue placeholder={options.length ? "Pick an artifact…" : "Nothing left to attach"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.artifactId} · {a.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" className="h-8 text-xs" disabled={!selected || submitting} onClick={handleAttach}>
        {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
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
  const linkedIds = new Set(artifacts.map((a) => a.id));

  const [attaching, setAttaching] = useState(false);

  async function handleAttach(artifactId: string) {
    try {
      await requestJson(`/api/admin/knowledge/artifacts/${artifactId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "sku", value: assetId }),
      });
      toast.success("Artifact attached");
      setAttaching(false);
      mutate();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to attach artifact");
    }
  }

  async function handleRemove(a: LinkedArtifact) {
    try {
      await requestJson(`/api/admin/knowledge/artifacts/${a.id}/links/sku/${a.linkId}`, { method: "DELETE" });
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
                  onClick={() => handleRemove(a)}
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
          <AttachArtifactControl
            linkedIds={linkedIds}
            onAttach={handleAttach}
            onCancel={() => setAttaching(false)}
          />
        )}
      </div>
    </section>
  );
}
