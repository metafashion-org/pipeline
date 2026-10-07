"use client";

import { useState } from "react";
import useSWR from "swr";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { jsonFetcher } from "@/lib/fetcher";

interface RegistryArtifact {
  id: string;
  artifactId: string;
  title: string;
  typeLabel: string;
}

// How many matches the picker lists at once.
const MAX_MATCHES = 8;

/**
 * Attaches Registry artifacts (an insight, a trend brief, a moodboard...) to an asset while it's
 * being added, so it's clear what it came from. Search by ID or title; picked ones show as chips.
 */
export function RegistryLinksPicker({ value, onChange, idPrefix }: { value: string[]; onChange: (ids: string[]) => void; idPrefix: string }) {
  const { data } = useSWR<{ artifacts: RegistryArtifact[] }>("/api/admin/knowledge/artifacts", jsonFetcher);
  const [query, setQuery] = useState("");
  const artifacts = data?.artifacts ?? [];
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? artifacts
        .filter((a) => !value.includes(a.id) && `${a.artifactId} ${a.title} ${a.typeLabel}`.toLowerCase().includes(needle))
        .slice(0, MAX_MATCHES)
    : [];

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${idPrefix}-registry`}>Registry links</Label>
      <p className="text-xs text-muted-foreground">The insight, trend brief or moodboard this asset comes from.</p>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const a = byId.get(id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                {a ? `${a.artifactId} · ${a.title}` : "Linked item"}
                <button type="button" onClick={() => onChange(value.filter((v) => v !== id))} aria-label={`Remove ${a?.title ?? "link"}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <Input
          id={`${idPrefix}-registry`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by ID or title, e.g. INS002 or Christmas"
          className="h-9"
          autoComplete="off"
        />
        {matches.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {matches.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onChange([...value, a.id]);
                  setQuery("");
                }}
                className="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span className="font-mono">{a.artifactId}</span> · {a.title} <span className="text-muted-foreground">({a.typeLabel})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
