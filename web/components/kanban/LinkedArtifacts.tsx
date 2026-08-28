"use client";

import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetcher";
import { ExternalLink, BookOpen } from "lucide-react";

interface LinkedArtifact {
  id: string;
  artifactId: string;
  title: string;
  typeLabel: string;
  fileUrl: string | null;
  usageNotes: string | null;
}

// The other end of the Knowledge Registry's SKU-linking (see
// ArtifactLinksDialog.tsx) - the brief's §7 whole point ("reuse knowledge
// instead of rewriting context for every asset") only actually happens if
// someone looking at an asset can SEE what's linked to it. Loads only when
// the drawer opens, same as AssetHistory.
export function LinkedArtifacts({ sku, enabled }: { sku: string; enabled: boolean }) {
  const { data, isLoading } = useSWR<{ artifacts: LinkedArtifact[] }>(
    enabled ? `/api/assets/${encodeURIComponent(sku)}/artifacts` : null,
    jsonFetcher
  );

  const artifacts = data?.artifacts || [];
  if (!isLoading && artifacts.length === 0) return null;

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <BookOpen className="h-3.5 w-3.5" /> Linked Knowledge
      </h4>
      <div className="bg-muted/30 p-3 rounded-md text-sm space-y-2">
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {artifacts.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-[10px] text-muted-foreground">
                {a.artifactId} · {a.typeLabel}
              </p>
              <p className="truncate">{a.title}</p>
              {a.usageNotes && <p className="text-xs text-muted-foreground truncate">{a.usageNotes}</p>}
            </div>
            {a.fileUrl && (
              <a
                href={a.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline shrink-0"
                title="Open"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
