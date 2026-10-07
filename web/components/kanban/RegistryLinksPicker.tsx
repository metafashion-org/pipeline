"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";
import { CURATION_NOTE_PROMPT } from "@/lib/assets/curation-note";

interface RegistryArtifact {
  id: string;
  artifactId: string;
  title: string;
  typeLabel: string;
  typePrefix: string;
  createdAt: string;
  lastLinkedAt: string | null;
}

type SortMode = "added" | "used";
const ALL_TYPES = "__all__";

/** Newest first by the chosen date. By use, never-used items go last, newest added first. */
function sortArtifacts(artifacts: RegistryArtifact[], mode: SortMode): RegistryArtifact[] {
  const time = (value: string | null) => (value ? new Date(value).getTime() : 0);
  const added = (a: RegistryArtifact, b: RegistryArtifact) => time(b.createdAt) - time(a.createdAt);
  if (mode === "added") return [...artifacts].sort(added);
  return [...artifacts].sort((a, b) => time(b.lastLinkedAt) - time(a.lastLinkedAt) || added(a, b));
}

/**
 * Attaches Registry artifacts (insights, trend briefs, moodboards...) to an asset while it's being
 * added. Browse by type, newest added or most recently used, or search; tick as many as needed in one
 * go. Once some are picked, a comment says how they come together to explain the item.
 */
export function RegistryLinksPicker({
  value,
  onChange,
  note,
  onNoteChange,
  idPrefix,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  note: string;
  onNoteChange: (note: string) => void;
  idPrefix: string;
}) {
  const { data } = useSWR<{ artifacts: RegistryArtifact[] }>("/api/admin/knowledge/artifacts", jsonFetcher);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState(ALL_TYPES);
  const [sort, setSort] = useState<SortMode>("added");

  const artifacts = data?.artifacts ?? [];
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const types = [...new Map(artifacts.map((a) => [a.typePrefix, a.typeLabel])).entries()];
  const needle = query.trim().toLowerCase();
  const shown = sortArtifacts(
    artifacts.filter(
      (a) =>
        (type === ALL_TYPES || a.typePrefix === type) && (!needle || `${a.artifactId} ${a.title} ${a.typeLabel}`.toLowerCase().includes(needle))
    ),
    sort
  );
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <div>
          <Label htmlFor={`${idPrefix}-registry`}>Registry links</Label>
          <p className="text-xs text-muted-foreground">The insights, trend briefs or moodboards this asset comes from.</p>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setOpen(!open)}>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} {open ? "Done" : "Browse"}
        </Button>
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const a = byId.get(id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                {a ? `${a.artifactId} · ${a.title}` : "Linked item"}
                <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${a?.title ?? "link"}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {open && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              id={`${idPrefix}-registry`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ID or title"
              className="col-span-2 h-8"
              autoComplete="off"
            />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES}>All types</SelectItem>
                {types.map(([prefix, label]) => (
                  <SelectItem key={prefix} value={prefix}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="Order">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="added">Recently added</SelectItem>
                <SelectItem value="used">Recently used</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-border rounded border">
            {!data && <p className="p-2 text-xs text-muted-foreground">Loading...</p>}
            {data && shown.length === 0 && <p className="p-2 text-xs text-muted-foreground">Nothing matches.</p>}
            {shown.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-start gap-2 px-2 py-1.5 text-xs hover:bg-muted">
                <input type="checkbox" checked={value.includes(a.id)} onChange={() => toggle(a.id)} className="mt-0.5 h-3.5 w-3.5 accent-primary" />
                <span className="min-w-0 flex-1">
                  <span className="font-mono">{a.artifactId}</span> · {a.title}
                  <span className="block text-[11px] text-muted-foreground">
                    {a.typeLabel} · added {formatDate(a.createdAt)}
                    {a.lastLinkedAt ? ` · last used ${formatDate(a.lastLinkedAt)}` : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{value.length} picked. Tick as many as you need, then Done.</p>
        </div>
      )}

      {value.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-registry-note`}>How do these come together?</Label>
          <Textarea id={`${idPrefix}-registry-note`} rows={3} value={note} onChange={(e) => onNoteChange(e.target.value)} placeholder={CURATION_NOTE_PROMPT} />
          <p className="text-[11px] text-muted-foreground">For the team and Arjun&apos;s sign-off. Not shown to the artist.</p>
        </div>
      )}
    </div>
  );
}
