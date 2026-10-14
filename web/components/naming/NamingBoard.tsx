"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DriveImage } from "@/components/kanban/drive-image";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import type { NamingView } from "@/lib/naming/naming-service";
import type { VariantView } from "@/lib/naming/variant-naming";

const NAMING_URL = "/api/admin/naming";
const MAX_NAME_CHARS = 49;

interface NamingResponse {
  items: NamingView[];
  variants: VariantView[];
  guidelines: { text: string; isDefault: boolean };
  model: string;
  keyConfigured: boolean;
}

/** One item waiting to upload: its concept images, Claude's suggestions with word sources, and approval. */
function NamingCard({ item, onChanged }: { item: NamingView; onChanged: () => void }) {
  const first = item.proposal?.candidates[0]?.name ?? "";
  const [name, setName] = useState(first);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(item.proposal?.candidates[0]?.name ?? ""), [item.proposal?.id, item.proposal?.candidates]);

  async function suggestForThis() {
    setBusy(true);
    try {
      const { ok, data } = await apiCall<{ error?: string; named: number; skipped: number; failed: number }>(NAMING_URL, { method: "POST", body: { action: "run", skus: [item.sku] } });
      if (!ok) toast.error(data.error || "Naming failed");
      else if (data.named) toast.success(`Suggestions ready for ${item.sku}`);
      else if (data.skipped) toast.info("Nothing changed since the last suggestions, so nothing was sent");
      else toast.error("Claude didn't return suggestions; see the card");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    try {
      const { ok, data } = await apiCall<{ error?: string }>(NAMING_URL, { method: "POST", body: { action: "approve", sku: item.sku, proposalId: item.proposal?.id ?? null, name } });
      if (!ok) toast.error(data.error || "Couldn't approve");
      else toast.success(`${item.sku} named "${name}"`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded-lg border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] text-muted-foreground">
            {item.sku} · {item.category ?? "no category"} · {item.evidenceCount} evidence source{item.evidenceCount === 1 ? "" : "s"}
          </p>
          <p className="text-muted-foreground">Working title: {item.itemName}</p>
        </div>
        <span className="flex items-center gap-2">
          {item.approvedName && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">Approved: {item.approvedName}</span>}
          {!item.approvedName && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={suggestForThis}>
              <Sparkles className="mr-1 h-3 w-3" />
              {busy ? "Asking Claude…" : "Suggest for this item"}
            </Button>
          )}
        </span>
      </div>
      <details>
        <summary className="cursor-pointer text-muted-foreground">What Claude reads for this item</summary>
        <div className="mt-1 space-y-1 rounded bg-muted/50 p-2">
          <p>
            <span className="font-medium">Working title</span> (only to know which item; never a word source): {item.reads.workingTitle}
          </p>
          <p>
            <span className="font-medium">Category:</span> {item.reads.category ?? "none"}
          </p>
          <p>
            <span className="font-medium">Trend note:</span> {item.reads.trendNote ?? "none"}
          </p>
          <p className="font-medium">Linked artifacts (the Registry summary only, not the document behind the link):</p>
          {item.reads.artifacts.length === 0 ? (
            <p className="text-muted-foreground">None linked.</p>
          ) : (
            <ul className="list-inside list-disc">
              {item.reads.artifacts.map((a) => (
                <li key={a.artifactId}>
                  {a.artifactId} {a.title}
                  {a.description ? ` — ${a.description}` : ""}
                  {a.tags.length ? ` (tags: ${a.tags.join(", ")})` : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="font-medium">Evidence quotes from the sheet&apos;s Evidence tab (full text from reports, workbooks, images):</p>
          {item.reads.evidence.length === 0 ? (
            <p className="text-muted-foreground">None yet. Add rows in the Evidence tab and sync the sheet to give Claude the detail from the documents.</p>
          ) : (
            <ul className="list-inside list-disc">
              {item.reads.evidence.map((e) => (
                <li key={e.label + e.quote}>
                  {e.label}: &ldquo;{e.quote}&rdquo;
                </li>
              ))}
            </ul>
          )}
          <p>
            <span className="font-medium">Concept images:</span> {item.reads.imageCount} (shown above)
          </p>
        </div>
      </details>
      {item.imageFileIds.length > 0 && (
        <div className="flex gap-2">
          {item.imageFileIds.map((id) => (
            <div key={id} className="relative h-24 w-24 overflow-hidden rounded bg-muted">
              <DriveImage fileId={id} alt={`${item.sku} concept`} sizes="96px" className="object-contain" />
            </div>
          ))}
        </div>
      )}
      {!item.proposal && !item.approvedName && (
        <div className="space-y-1">
          <p className="text-muted-foreground">No suggestions yet. Run naming, or type a name you already approved (every word still needs evidence).</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Base name" className="h-8 max-w-sm text-xs" />
            <Button size="sm" className="h-8 text-xs" disabled={busy || !name.trim() || name.length > MAX_NAME_CHARS} onClick={approve}>
              Approve name
            </Button>
          </div>
        </div>
      )}
      {item.proposal?.status === "failed" && <p className="text-destructive">Naming failed: {item.proposal.error}</p>}
      {item.proposal && item.proposal.status !== "failed" && (
        <>
          {item.proposal.imageNotes && (
            <p>
              <span className="font-medium">What Claude sees in the images:</span> {item.proposal.imageNotes}
            </p>
          )}
          <ul className="space-y-1">
            {item.proposal.candidates.map((c) => {
              const blocked = c.unsupported.length > 0 || c.conflictOnly.length > 0;
              return (
                <li key={c.name} className="rounded border p-1.5">
                  <button type="button" onClick={() => setName(c.name)} className={`font-medium hover:underline ${blocked ? "text-destructive" : ""}`}>
                    {c.name}
                  </button>{" "}
                  <span className="text-muted-foreground">({c.name.length}/{MAX_NAME_CHARS})</span>
                  <p className="text-muted-foreground">{c.why}</p>
                  <p className="text-muted-foreground">{c.words.map((w) => `${w.word} ← ${w.source}`).join(" · ")}</p>
                  {c.unsupported.length > 0 && <p className="text-destructive">Not in any evidence: {c.unsupported.join(", ")}</p>}
                  {c.conflictOnly.length > 0 && <p className="text-destructive">Only conflicting evidence: {c.conflictOnly.join(", ")}</p>}
                </li>
              );
            })}
          </ul>
          {!item.approvedName && item.proposal.status === "pending" && (
            <div className="flex flex-wrap items-center gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 max-w-sm text-xs" />
              <span className={name.length > MAX_NAME_CHARS ? "text-destructive" : "text-muted-foreground"}>
                {name.length}/{MAX_NAME_CHARS}
              </span>
              <Button size="sm" className="h-8 text-xs" disabled={busy || !name.trim() || name.length > MAX_NAME_CHARS} onClick={approve}>
                Approve name
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** One item's colour versions: each suggested name, editable, with its image reading and any problem. */
function VariantCard({ view, onChanged }: { view: VariantView; onChanged: () => void }) {
  const [names, setNames] = useState(view.candidates.map((c) => c.name));
  const [busy, setBusy] = useState(false);
  useEffect(() => setNames(view.candidates.map((c) => c.name)), [view.proposalId, view.candidates]);

  async function approve() {
    setBusy(true);
    try {
      const body = { action: "approve_variants", sku: view.sku, proposalId: view.proposalId, names: view.candidates.map((c, i) => ({ listingId: c.listingId, colour: c.colour, name: names[i] })) };
      const { ok, data } = await apiCall<{ error?: string }>(NAMING_URL, { method: "POST", body });
      if (!ok) toast.error(data.error || "Couldn't approve");
      else toast.success(`${view.sku}: ${names.length} variant names approved`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded-lg border bg-card p-3 text-xs">
      <p className="font-mono text-[11px] text-muted-foreground">
        {view.sku} · base name &quot;{view.baseName}&quot; · {view.kind === "colourways" ? "colourways from the recolour sheet (before upload)" : "live listings, from each Roblox thumbnail"} · {view.status}
      </p>
      {view.status === "failed" && <p className="text-destructive">Variant naming failed: {view.error}</p>}
      <ul className="space-y-1">
        {view.candidates.map((c, i) => (
          <li key={c.listingId ?? c.colour} className="rounded border p-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {c.robloxAssetId && <span className="font-mono text-muted-foreground">{c.robloxAssetId}</span>}
              <Input
                value={names[i] ?? ""}
                disabled={view.status !== "pending"}
                onChange={(e) => setNames((n) => n.map((v, j) => (j === i ? e.target.value : v)))}
                className="h-7 max-w-sm text-xs"
              />
              <span className={(names[i] ?? "").length > MAX_NAME_CHARS ? "text-destructive" : "text-muted-foreground"}>
                {(names[i] ?? "").length}/{MAX_NAME_CHARS}
              </span>
            </div>
            <p className="text-muted-foreground">Seen: {c.imageNote}</p>
            {names[i] === c.name && c.problems.map((p) => <p key={p} className="text-destructive">{p}</p>)}
          </li>
        ))}
      </ul>
      {view.status === "pending" && (
        <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={approve}>
          Approve all {view.candidates.length} names
        </Button>
      )}
    </section>
  );
}

/**
 * The Naming page: items at Ready for upload, Claude's suggested names with the source of every
 * word, Arjun's approval, and his naming guidelines. The approved name goes to the uploader.
 */
export function NamingBoard() {
  const { data, mutate, isLoading } = useSWR<NamingResponse>(NAMING_URL, jsonFetcher, { revalidateOnFocus: false });
  const [running, setRunning] = useState(false);
  const [guidelines, setGuidelines] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Couldn&apos;t load naming.</p>;

  async function run() {
    setRunning(true);
    try {
      const { ok, data: res } = await apiCall<{ error?: string; named: number; skipped: number; failed: number }>(NAMING_URL, { method: "POST", body: { action: "run" } });
      if (!ok) toast.error(res.error || "Naming failed");
      else toast.success(`Named ${res.named}, skipped ${res.skipped} unchanged, ${res.failed} failed`);
      await mutate();
    } finally {
      setRunning(false);
    }
  }

  async function saveGuidelines() {
    if (guidelines === null) return;
    const { ok, data: res } = await apiCall<{ error?: string }>(NAMING_URL, { method: "PUT", body: { text: guidelines } });
    if (!ok) toast.error(res.error || "Couldn't save");
    else {
      toast.success("Guidelines saved. Items will get fresh suggestions on the next run.");
      setGuidelines(null);
      await mutate();
    }
  }

  async function runVariants() {
    setRunning(true);
    try {
      const { ok, data: res } = await apiCall<{ error?: string; named: number; skipped: number; failed: number }>(NAMING_URL, { method: "POST", body: { action: "run_variants" } });
      if (!ok) toast.error(res.error || "Variant naming failed");
      else toast.success(`Variant names for ${res.named} items, ${res.skipped} unchanged, ${res.failed} failed`);
      await mutate();
    } finally {
      setRunning(false);
    }
  }

  const waiting = data.items.filter((i) => !i.approvedName).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {data.items.length} items waiting to upload or live · {waiting} without an approved base name · model {data.model}
        </p>
        <Button size="sm" variant="outline" disabled={running || !data.keyConfigured} onClick={run}>
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {running ? "Naming…" : "Suggest names now"}
        </Button>
      </div>
      {!data.keyConfigured && <p className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs">Add ANTHROPIC_API_KEY in Vercel to turn naming on.</p>}

      <details className="rounded-lg border bg-card p-3 text-xs">
        <summary className="cursor-pointer font-semibold">Naming guidelines{data.guidelines.isDefault ? " (default draft: edit and save your own)" : ""}</summary>
        <Textarea value={guidelines ?? data.guidelines.text} onChange={(e) => setGuidelines(e.target.value)} rows={12} className="mt-2 text-xs" />
        <Button size="sm" className="mt-2 h-7 text-xs" disabled={guidelines === null} onClick={saveGuidelines}>
          Save guidelines
        </Button>
      </details>

      <h2 className="text-sm font-semibold">Base names</h2>
      {data.items.map((item) => (
        <NamingCard key={item.sku} item={item} onChanged={() => mutate()} />
      ))}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <h2 className="mr-auto text-sm font-semibold">Variant names (one per colour, &quot;&lt;Colour&gt; &lt;Base name&gt;&quot;)</h2>
        <Button size="sm" variant="outline" disabled={running || !data.keyConfigured} onClick={runVariants}>
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {running ? "Naming…" : "Suggest variant names now"}
        </Button>
      </div>
      {data.variants.length === 0 && <p className="text-xs text-muted-foreground">Items get variant names once their base name is approved.</p>}
      {data.variants.map((v) => (
        <VariantCard key={`${v.sku}-${v.kind}`} view={v} onChanged={() => mutate()} />
      ))}
    </div>
  );
}
