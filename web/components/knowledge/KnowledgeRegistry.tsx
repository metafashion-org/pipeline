"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ExternalLink, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { RegistryArtifactView } from "@/lib/dashboard/views";
import { TREND_BRIEF_PREFIX } from "@/lib/knowledge/artifact-forms";
import { ArtifactLinksDialog } from "./ArtifactLinksDialog";
import { ArtifactDetailSheet } from "./ArtifactDetailSheet";
import { NewArtifactDialog, type ArtifactTypeOption } from "./NewArtifactDialog";

// GET returns the same rows the page was rendered with (lib/knowledge/artifacts-service.ts), so a
// create or archive refreshes the list without a page reload.
const ARTIFACTS_URL = "/api/admin/knowledge/artifacts";
const ALL_TYPES = "all";
// How much of an artifact's description the list shows under its title.
const SNIPPET_CHARS = 140;

function matchesSearch(artifact: RegistryArtifactView, query: string): boolean {
  if (!query) return true;
  const haystack = [artifact.artifactId, artifact.title, artifact.description, artifact.usageNotes, artifact.typeLabel, ...(artifact.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/**
 * The Registry: every artifact with its permanent typed ID (TR001, INS002, ...), filterable by
 * type and searchable, with the New Artifact form and each artifact's detail sheet.
 */
export function KnowledgeRegistry({
  initialArtifacts,
  artifactTypes,
}: {
  initialArtifacts: RegistryArtifactView[];
  artifactTypes: ArtifactTypeOption[];
}) {
  const { data, mutate } = useSWR<{ artifacts: RegistryArtifactView[] }>(ARTIFACTS_URL, jsonFetcher, {
    fallbackData: { artifacts: initialArtifacts },
  });
  const artifacts = data?.artifacts ?? initialArtifacts;
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [linksArtifact, setLinksArtifact] = useState<RegistryArtifactView | null>(null);

  const trendBriefs = useMemo(() => artifacts.filter((a) => a.typePrefix === TREND_BRIEF_PREFIX), [artifacts]);
  // Chips for the types that have artifacts, in the order types are configured.
  const typeChips = artifactTypes.filter((t) => artifacts.some((a) => a.typePrefix === t.prefix));
  const shown = artifacts
    .filter((a) => typeFilter === ALL_TYPES || a.typePrefix === typeFilter)
    .filter((a) => matchesSearch(a, query.trim()))
    .slice()
    .reverse();
  const openArtifact = artifacts.find((a) => a.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {[{ prefix: ALL_TYPES, label: "All" }, ...typeChips].map((t) => (
            <button
              key={t.prefix}
              type="button"
              onClick={() => setTypeFilter(t.prefix)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                typeFilter === t.prefix ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the Registry" className="h-8 w-[220px] pl-7 text-xs" />
        </div>
        <NewArtifactDialog types={artifactTypes} trendBriefs={trendBriefs} onCreated={() => mutate()} />
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-medium">ID</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Added</th>
                <th className="text-left px-4 py-2 font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {artifacts.length === 0 ? "Nothing in the Registry yet. Add the first one above." : "Nothing matches."}
                  </td>
                </tr>
              )}
              {shown.map((a) => (
                <tr key={a.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={() => setOpenId(a.id)}>
                  <td className="px-4 py-2 font-mono text-xs align-top">{a.artifactId}</td>
                  <td className="px-4 py-2 text-muted-foreground align-top">{a.typeLabel}</td>
                  <td className="px-4 py-2 align-top">
                    <p>{a.title}</p>
                    {a.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {a.description.length > SNIPPET_CHARS ? `${a.description.slice(0, SNIPPET_CHARS)}...` : a.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs align-top whitespace-nowrap">
                    {formatDate(a.createdAt)}
                    {a.addedByName && <span className="block">{a.addedByName}</span>}
                  </td>
                  <td className="px-4 py-2 align-top">
                    {a.fileUrl && (
                      <a
                        href={a.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline inline-flex items-center gap-1"
                        aria-label={`Open ${a.artifactId}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ArtifactDetailSheet
        artifact={openArtifact}
        allArtifacts={artifacts}
        onOpenChange={(open) => !open && setOpenId(null)}
        onManageLinks={(a) => setLinksArtifact(a)}
        onArchived={() => {
          setOpenId(null);
          mutate();
        }}
      />

      {linksArtifact && (
        <ArtifactLinksDialog
          open={!!linksArtifact}
          onOpenChange={(v) => !v && setLinksArtifact(null)}
          artifactId={linksArtifact.id}
          artifactLabel={`${linksArtifact.artifactId} — ${linksArtifact.title}`}
          onLinksChanged={() => mutate()}
        />
      )}
    </div>
  );
}
