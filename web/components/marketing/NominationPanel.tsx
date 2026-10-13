"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { AUDIENCES, FIELD_LIMITS, ITEM_TYPES, type DraftField, type DraftFields } from "@/lib/marketing/nomination-fields";
import type { NominationView } from "@/lib/marketing/nomination-service";

const NOMINATION_URL = "/api/admin/marketing/todays-picks/nomination";
const COVERAGE_NOTE = "Covers the form's item page only. Later pages are unverified.";

// The item page's fields in the form's order, with the label Roblox uses.
const FORM_ROWS: { field: DraftField; label: string; required: boolean; kind: "text" | "lines" | "type" | "audience" }[] = [
  { field: "item_link", label: "Link to your item, bundle, or look", required: true, kind: "text" },
  { field: "item_type", label: "Item type", required: true, kind: "type" },
  { field: "tags", label: "Tags / categories", required: true, kind: "text" },
  { field: "audience", label: "Audience (optional)", required: false, kind: "audience" },
  { field: "colour_links", label: "Links to additional colours / variations (optional, needs your approval)", required: false, kind: "lines" },
  { field: "season", label: "Seasons / holidays (optional)", required: false, kind: "text" },
  { field: "extra_info", label: "Anything else about the item (optional)", required: false, kind: "text" },
  { field: "theme", label: "Theme suggestion for a future edition (optional)", required: false, kind: "text" },
];

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
}

function Counter({ value, limit }: { value: string; limit?: number }) {
  if (!limit) return null;
  return <span className={`text-[11px] ${value.length > limit ? "font-medium text-destructive" : "text-muted-foreground"}`}>{value.length}/{limit}</span>;
}

function ProblemList({ messages }: { messages: string[] }) {
  return (
    <>
      {messages.map((m) => (
        <p key={m} className="text-destructive">{m}</p>
      ))}
    </>
  );
}

/**
 * One SKU's Today's Picks nomination: evidence-based name words, editable item-page answers with
 * the form's limits, explicit approval of the name and colour links, the assistant's suggestions,
 * and Arjun's own confirmation that he filed it. Nothing here is sent to Roblox or verified with it.
 */
export function NominationPanel({ sku, onChanged }: { sku: string; onChanged: () => void }) {
  const url = `${NOMINATION_URL}?sku=${encodeURIComponent(sku)}`;
  const { data, mutate, isLoading } = useSWR<NominationView>(url, jsonFetcher, { revalidateOnFocus: false });
  const [fields, setFields] = useState<DraftFields>({});
  // Never prefilled: Arjun ticks it each time he confirms a filing.
  const [rights, setRights] = useState(false);
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);

  // Start from the saved draft, or from the suggestions when nothing is saved.
  useEffect(() => {
    if (data) setFields(data.draft?.fields ?? data.proposed);
  }, [data]);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading nomination…</p>;
  if (!data) return <p className="text-xs text-destructive">Couldn&apos;t load the nomination.</p>;

  const filed = data.draft?.state === "submitted";
  const set = (field: DraftField, value: string) => setFields((f) => ({ ...f, [field]: value }));
  const dirty = JSON.stringify(fields) !== JSON.stringify(data.draft?.fields ?? null);
  const approved = (field: "final_name" | "colour_links") => !!data.draft && data.draft.approvals[field]?.value === (data.draft.fields[field] ?? "").trim();
  const problemsFor = (field: string) => data.problems.filter((p) => p.field === field).map((p) => p.message);
  const newSuggestions = data.suggestions.filter((s) => s.status === "new");

  async function run(body: Record<string, unknown>, method: "PUT" | "POST", success: string) {
    setBusy(true);
    try {
      const { ok, data: res } = await apiCall<{ error?: string }>(NOMINATION_URL, { method, body: { sku, ...body } });
      if (!ok) toast.error(res.error || "That didn't work");
      else toast.success(success);
      await mutate();
      onChanged();
      return ok;
    } finally {
      setBusy(false);
    }
  }

  const save = () => run({ fields }, "PUT", "Draft saved");
  const approve = (field: "final_name" | "colour_links") =>
    run({ action: "approve", draftId: data.draft!.id, field }, "POST", field === "final_name" ? "Name approved" : "Colour links approved");
  const confirm = async () => {
    if (!data.draft || !window.confirm("Record that you filed this nomination on Roblox's form yourself? The Kanban can't verify it with Roblox.")) return;
    const ok = await run({ action: "confirm", draftId: data.draft.id, rightsConfirmed: rights, evidence: proof || null }, "POST", "Filing recorded");
    if (ok) {
      setRights(false);
      setProof("");
    }
  };
  const undo = async () => {
    const reason = window.prompt("Why was this confirmation wrong?");
    if (reason && data.draft) await run({ action: "undo", draftId: data.draft.id, reason }, "POST", "Confirmation undone");
  };
  const suggestion = (id: string, status: "used" | "dismissed", field?: string, value?: string) => {
    if (status === "used" && field && value) set(field as DraftField, value);
    void run({ action: "suggestion", suggestionId: id, status }, "POST", status === "used" ? "Filled in; save and approve to keep it" : "Dismissed");
  };
  const addTerm = (term: string) => set("final_name", [fields.final_name ?? "", term.charAt(0).toUpperCase() + term.slice(1)].join(" ").trim());

  return (
    <div className="space-y-3 rounded-md border bg-background p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Today&apos;s Picks nomination</span>
        <span className="rounded bg-muted px-1.5 py-0.5">
          {!data.draft ? "Not started" : filed ? `Filed (owner-confirmed) ${new Date(data.draft.submittedAt!).toLocaleString("en-IN")}` : "Draft"}
        </span>
        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">{COVERAGE_NOTE}</span>
      </div>

      <div className="grid gap-1 rounded bg-muted/50 p-2">
        <p>
          Username: <span className="font-mono">{data.owner.username}</span> <Copy className="inline h-3 w-3 cursor-pointer" onClick={() => copy(data.owner.username)} /> · Email:{" "}
          <span className="font-mono">{data.owner.email}</span> <Copy className="inline h-3 w-3 cursor-pointer" onClick={() => copy(data.owner.email)} />
        </p>
        <p className="text-muted-foreground">Birthdate and the rights question are yours to answer on the form. The Kanban never fills them.</p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="font-medium">Final name (rename the Roblox listing to this; not a form field)</label>
          <span className="flex items-center gap-2">
            {approved("final_name") && <span className="text-emerald-600">Approved</span>}
            <Counter value={fields.final_name ?? ""} limit={FIELD_LIMITS.final_name} />
          </span>
        </div>
        {data.hasNameEvidence ? (
          <>
            <Input value={fields.final_name ?? ""} disabled={filed} onChange={(e) => set("final_name", e.target.value)} placeholder="Build it from the evidence words below" className="h-8 text-xs" />
            {!filed && data.nameTerms.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {data.nameTerms.map((t) => (
                  <button key={t.term} type="button" title={t.sources.join(", ")} onClick={() => addTerm(t.term)} className="rounded border px-1.5 py-0.5 hover:bg-muted">
                    {t.term} <span className="text-muted-foreground">({t.sources.length})</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="rounded border border-amber-500/40 bg-amber-500/5 p-2">
            No linked artifacts and no trend origin, so the final name stays unset. Link an artifact to this SKU or add a grounded name suggestion in the sheet.
          </p>
        )}
        <ProblemList messages={problemsFor("final_name")} />
        <details>
          <summary className="cursor-pointer text-muted-foreground">Evidence ({data.evidence.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {data.evidence.map((e) => (
              <li key={e.label + e.value}>
                <span className="font-medium">{e.label}:</span> <span className="whitespace-pre-wrap">{e.value}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      {FORM_ROWS.map((row) => {
        const value = fields[row.field] ?? "";
        const limit = (FIELD_LIMITS as Record<string, number>)[row.field];
        return (
          <div key={row.field} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="font-medium">
                {row.label}
                {row.required && <span className="text-destructive"> *</span>}
              </label>
              <span className="flex items-center gap-2">
                {row.field === "colour_links" && approved("colour_links") && <span className="text-emerald-600">Approved</span>}
                <Counter value={value} limit={limit} />
                {value && <Copy className="h-3 w-3 cursor-pointer" onClick={() => copy(value)} />}
              </span>
            </div>
            {row.kind === "type" || row.kind === "audience" ? (
              <select value={value} disabled={filed} onChange={(e) => set(row.field, e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-xs">
                <option value="">{row.kind === "type" ? "Pick one" : "Leave blank"}</option>
                {(row.kind === "type" ? ITEM_TYPES : AUDIENCES).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : row.kind === "lines" ? (
              <Textarea value={value} disabled={filed} rows={3} onChange={(e) => set(row.field, e.target.value)} className="text-xs" />
            ) : (
              <Input value={value} disabled={filed} onChange={(e) => set(row.field, e.target.value)} className="h-8 text-xs" />
            )}
            <ProblemList messages={problemsFor(row.field)} />
          </div>
        );
      })}

      {problemsFor("roblox").length > 0 && (
        <div className="space-y-0.5 rounded border border-amber-500/40 bg-amber-500/5 p-2">
          <p className="font-medium">Fix on Roblox first</p>
          <ProblemList messages={problemsFor("roblox")} />
        </div>
      )}

      {newSuggestions.length > 0 && !filed && (
        <div className="space-y-1">
          <p className="font-medium">Suggestions from the sheet</p>
          {newSuggestions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded border p-1.5">
              <span className="font-mono">{s.field}</span>
              <span className="flex-1">{s.value}</span>
              {s.evidence && <span className="text-muted-foreground">({s.evidence})</span>}
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => suggestion(s.id, "used", s.field, s.value)}>
                Use
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => suggestion(s.id, "dismissed")}>
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}

      {!filed && (
        <div className="space-y-2 border-t pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-7 text-xs" disabled={busy || (!dirty && !!data.draft)} onClick={save}>
              Save draft
            </Button>
            {data.draft && !dirty && (
              <>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || approved("final_name") || !data.hasNameEvidence} onClick={() => approve("final_name")}>
                  Approve name
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || approved("colour_links")} onClick={() => approve("colour_links")}>
                  Approve colour links
                </Button>
              </>
            )}
            {dirty && data.draft && <span className="text-muted-foreground">Save before approving or confirming.</span>}
          </div>
          {data.draft && !dirty && (
            <div className="space-y-1 rounded border p-2">
              <p className="text-amber-700 dark:text-amber-400">{COVERAGE_NOTE} Confirming records that you filed it yourself; the Kanban can&apos;t verify it with Roblox.</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />I answered the rights question on the form myself
                </label>
                <Input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Proof (optional), e.g. confirmation page seen" className="h-7 w-64 text-xs" />
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !rights || data.problems.length > 0} onClick={confirm}>
                  I filed it on Roblox
                </Button>
              </div>
              {data.problems.length > 0 && <p className="text-muted-foreground">{data.problems.length} thing(s) to fix before confirming.</p>}
            </div>
          )}
        </div>
      )}

      {filed && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <span>
            Filed, owner-confirmed{data.draft?.submissionEvidence ? ` · proof: ${data.draft.submissionEvidence}` : ""}. {COVERAGE_NOTE} Roblox only contacts creators it selects.
          </span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={undo}>
            Recorded by mistake
          </Button>
        </div>
      )}

      {data.events.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">History ({data.events.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {data.events.map((e) => (
              <li key={e.createdAt + e.kind}>
                {new Date(e.createdAt).toLocaleString("en-IN")}: {e.kind.replaceAll("_", " ")}
                {typeof e.payload.reason === "string" ? ` (${e.payload.reason})` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
