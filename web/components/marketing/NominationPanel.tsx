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
import {
  AUDIENCES,
  FIELD_LIMITS,
  ITEM_TYPES,
  type DraftField,
  type DraftFields,
} from "@/lib/marketing/nomination-fields";
import type { NominationView } from "@/lib/marketing/nomination-service";

const NOMINATION_URL = "/api/admin/marketing/todays-picks/nomination";

// The form's fields in its own order, with the label Roblox uses.
const FORM_ROWS: {
  field: DraftField;
  label: string;
  required: boolean;
  kind: "text" | "lines" | "type" | "audience";
}[] = [
  {
    field: "item_link",
    label: "Link to your item, bundle, or look",
    required: true,
    kind: "text",
  },
  { field: "item_type", label: "Item type", required: true, kind: "type" },
  { field: "tags", label: "Tags / categories", required: true, kind: "text" },
  {
    field: "audience",
    label: "Audience (optional)",
    required: false,
    kind: "audience",
  },
  {
    field: "colour_links",
    label: "Links to additional colours / variations (optional)",
    required: false,
    kind: "lines",
  },
  {
    field: "season",
    label: "Seasons / holidays (optional)",
    required: false,
    kind: "text",
  },
  {
    field: "extra_info",
    label: "Anything else about the item (optional)",
    required: false,
    kind: "text",
  },
  {
    field: "theme",
    label: "Theme suggestion for a future edition (optional)",
    required: false,
    kind: "text",
  },
];

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
}

function Counter({ value, limit }: { value: string; limit?: number }) {
  if (!limit) return null;
  return (
    <span
      className={`text-[11px] ${value.length > limit ? "font-medium text-destructive" : "text-muted-foreground"}`}
    >
      {value.length}/{limit}
    </span>
  );
}

/**
 * One SKU's Today's Picks nomination: the Kanban's proposals and their evidence, Arjun's editable
 * answers with the form's limits, the assistant's suggestions, and the confirmation that Arjun filed
 * it on Roblox's form. Nothing here is sent to Roblox.
 */
export function NominationPanel({
  sku,
  onChanged,
}: {
  sku: string;
  onChanged: () => void;
}) {
  const url = `${NOMINATION_URL}?sku=${encodeURIComponent(sku)}`;
  const { data, mutate, isLoading } = useSWR<NominationView>(url, jsonFetcher, {
    revalidateOnFocus: false,
  });
  const [fields, setFields] = useState<DraftFields>({});
  const [rights, setRights] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);

  // Start from the saved draft, or from the Kanban's proposals when nothing is saved.
  useEffect(() => {
    if (data) setFields(data.draft?.fields ?? data.proposed);
  }, [data]);

  if (isLoading)
    return <p className="text-xs text-muted-foreground">Loading nomination…</p>;
  if (!data)
    return (
      <p className="text-xs text-destructive">
        Couldn&apos;t load the nomination.
      </p>
    );

  const submitted = data.draft?.state === "submitted";
  const set = (field: DraftField, value: string) =>
    setFields((f) => ({ ...f, [field]: value }));
  const dirty =
    JSON.stringify(fields) !== JSON.stringify(data.draft?.fields ?? null);

  async function run(
    fn: () => Promise<{ ok: boolean; data: { error?: string } }>,
    success: string,
  ) {
    setBusy(true);
    try {
      const { ok, data: res } = await fn();
      if (!ok) toast.error(res.error || "That didn't work");
      else toast.success(success);
      await mutate();
      onChanged();
      return ok;
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(
      () => apiCall(NOMINATION_URL, { method: "PUT", body: { sku, fields } }),
      "Draft saved",
    );
  const confirm = async () => {
    if (!data.draft) return;
    if (
      !window.confirm("Record that you filed this nomination on Roblox's form?")
    )
      return;
    await run(
      () =>
        apiCall(NOMINATION_URL, {
          method: "POST",
          body: {
            action: "confirm",
            sku,
            draftId: data.draft!.id,
            rightsConfirmed: rights,
            evidence: evidence || null,
          },
        }),
      "Nomination recorded",
    );
  };
  const undo = async () => {
    const reason = window.prompt("Why was this confirmation wrong?");
    if (reason && data.draft)
      await run(
        () =>
          apiCall(NOMINATION_URL, {
            method: "POST",
            body: { action: "undo", sku, draftId: data.draft!.id, reason },
          }),
        "Confirmation undone",
      );
  };
  const renominate = async () => {
    const reason = window.prompt(
      "What changed since the last nomination? (new name, new colours, a seasonal theme…)",
    );
    if (reason)
      await run(
        () =>
          apiCall(NOMINATION_URL, {
            method: "POST",
            body: { action: "renominate", sku, reason },
          }),
        "Re-nomination opened",
      );
  };
  const suggestion = (
    id: string,
    status: "used" | "dismissed",
    field?: string,
    value?: string,
  ) => {
    if (status === "used" && field && value) set(field as DraftField, value);
    void run(
      () =>
        apiCall(NOMINATION_URL, {
          method: "POST",
          body: { action: "suggestion", sku, suggestionId: id, status },
        }),
      status === "used" ? "Filled in; save to keep it" : "Dismissed",
    );
  };

  const problemsFor = (field: string) =>
    data.problems.filter((p) => p.field === field);
  const newSuggestions = data.suggestions.filter((s) => s.status === "new");

  return (
    <div className="space-y-3 rounded-md border bg-background p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Today&apos;s Picks nomination</span>
        <span className="rounded bg-muted px-1.5 py-0.5">
          {data.draft
            ? `Attempt ${data.draft.attemptNo}: ${data.draft.state}`
            : "Not started"}
          {data.draft?.submittedAt
            ? ` ${new Date(data.draft.submittedAt).toLocaleString("en-IN")}`
            : ""}
        </span>
        <span className="text-muted-foreground">Form: {data.formVersion}</span>
      </div>

      <div className="grid gap-1 rounded bg-muted/50 p-2">
        <p>
          Username: <span className="font-mono">{data.owner.username}</span>{" "}
          <Copy
            className="inline h-3 w-3 cursor-pointer"
            onClick={() => copy(data.owner.username)}
          />{" "}
          · Email: <span className="font-mono">{data.owner.email}</span>{" "}
          <Copy
            className="inline h-3 w-3 cursor-pointer"
            onClick={() => copy(data.owner.email)}
          />
        </p>
        <p className="text-muted-foreground">
          Birthdate and the rights question are yours to answer on the form.
        </p>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="font-medium">
            Final name (rename the Roblox listing to this; not a form field)
          </label>
          <Counter
            value={fields.final_name ?? ""}
            limit={FIELD_LIMITS.final_name}
          />
        </div>
        <Input
          value={fields.final_name ?? ""}
          disabled={submitted}
          onChange={(e) => set("final_name", e.target.value)}
          className="h-8 text-xs"
        />
        {problemsFor("final_name").map((p) => (
          <p key={p.message} className="text-destructive">
            {p.message}
          </p>
        ))}
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            Evidence behind the proposals ({data.evidence.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {data.evidence.map((e) => (
              <li key={e.label + e.value}>
                <span className="font-medium">{e.label}:</span>{" "}
                <span className="whitespace-pre-wrap">{e.value}</span>
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
                <Counter value={value} limit={limit} />
                {value && (
                  <Copy
                    className="h-3 w-3 cursor-pointer"
                    onClick={() => copy(value)}
                  />
                )}
              </span>
            </div>
            {row.kind === "type" || row.kind === "audience" ? (
              <select
                value={value}
                disabled={submitted}
                onChange={(e) => set(row.field, e.target.value)}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              >
                <option value="">
                  {row.kind === "type" ? "Pick one" : "Leave blank"}
                </option>
                {(row.kind === "type" ? ITEM_TYPES : AUDIENCES).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : row.kind === "lines" ? (
              <Textarea
                value={value}
                disabled={submitted}
                rows={3}
                onChange={(e) => set(row.field, e.target.value)}
                className="text-xs"
              />
            ) : (
              <Input
                value={value}
                disabled={submitted}
                onChange={(e) => set(row.field, e.target.value)}
                className="h-8 text-xs"
              />
            )}
            {problemsFor(row.field).map((p) => (
              <p key={p.message} className="text-destructive">
                {p.message}
              </p>
            ))}
          </div>
        );
      })}

      {problemsFor("roblox").length > 0 && (
        <div className="space-y-0.5 rounded border border-amber-500/40 bg-amber-500/5 p-2">
          <p className="font-medium">Fix on Roblox first</p>
          {problemsFor("roblox").map((p) => (
            <p key={p.message}>{p.message}</p>
          ))}
        </div>
      )}

      {newSuggestions.length > 0 && !submitted && (
        <div className="space-y-1">
          <p className="font-medium">Suggestions from the sheet</p>
          {newSuggestions.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded border p-1.5"
            >
              <span className="font-mono">{s.field}</span>
              <span className="flex-1">{s.value}</span>
              {s.evidence && (
                <span className="text-muted-foreground">({s.evidence})</span>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={busy}
                onClick={() => suggestion(s.id, "used", s.field, s.value)}
              >
                Use
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                disabled={busy}
                onClick={() => suggestion(s.id, "dismissed")}
              >
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}

      {!submitted && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={busy || (!dirty && !!data.draft)}
            onClick={save}
          >
            Save draft
          </Button>
          {data.draft && !dirty && (
            <>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(e) => setRights(e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                I answered the rights question on the form myself
              </label>
              <Input
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="Proof, e.g. confirmation page seen"
                className="h-7 w-56 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy || !rights || data.problems.length > 0}
                onClick={confirm}
              >
                I filed it on Roblox
              </Button>
            </>
          )}
          {data.problems.length > 0 && (
            <span className="text-muted-foreground">
              {data.problems.length} thing(s) to fix before filing
            </span>
          )}
        </div>
      )}

      {submitted && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <span>
            Filed
            {data.draft?.submissionEvidence
              ? ` · ${data.draft.submissionEvidence}`
              : ""}
            . Roblox only contacts creators it selects.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={busy}
            onClick={renominate}
          >
            Re-nominate after a change
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy}
            onClick={undo}
          >
            Recorded by mistake
          </Button>
        </div>
      )}

      {data.events.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">
            History ({data.events.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {data.events.map((e) => (
              <li key={e.createdAt + e.kind}>
                {new Date(e.createdAt).toLocaleString("en-IN")}:{" "}
                {e.kind.replace("_", " ")}
                {typeof e.payload.reason === "string"
                  ? ` (${e.payload.reason})`
                  : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
