"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiCall } from "@/lib/api-client";
import type { FilingPackage, OwnerDetails } from "@/lib/marketing/todays-picks-filing";

export const FILING_URL = "/api/admin/marketing/todays-picks/filing";
const FORM_URL = "https://survey.roblox.com/jfe/form/SV_8cZb94oj9OvQm9g";

// The item-page fields in the form's order, with Roblox's labels.
const ROWS: { key: keyof FilingPackage["fields"]; label: string }[] = [
  { key: "item_link", label: "Link to your item" },
  { key: "item_type", label: "Item type" },
  { key: "tags", label: "Tags / categories" },
  { key: "audience", label: "Audience" },
  { key: "colour_links", label: "Additional colours / variations" },
  { key: "season", label: "Seasons / holidays" },
  { key: "extra_info", label: "Anything else" },
  { key: "theme", label: "Theme suggestion" },
];
const EDITABLE: (keyof FilingPackage["fields"])[] = ["tags", "audience", "season", "extra_info", "theme"];

function copy(text: string, what = "Copied") {
  void navigator.clipboard.writeText(text).then(() => toast.success(what));
}

/** All the answers as one block, in the form's order, for pasting to the assistant. */
function asText(f: FilingPackage, owner: OwnerDetails): string {
  return [`${f.sku} · ${f.name ?? f.itemName}`, `Username: ${owner.username}`, `Email: ${owner.email}`, ...ROWS.filter((r) => f.fields[r.key]).map((r) => `${r.label}: ${f.fields[r.key]}`)].join("\n");
}

/** The username and email used on every filing, set once. */
export function OwnerDetailsCard({ owner, onChanged }: { owner: OwnerDetails; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(owner);

  async function save() {
    const { ok, data } = await apiCall<{ error?: string }>(FILING_URL, { method: "PUT", body: draft });
    if (!ok) toast.error(data.error || "Couldn't save");
    else {
      toast.success("Saved for every filing");
      setEditing(false);
      onChanged();
    }
  }

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-xs">
      <span className="font-semibold">Every Today&apos;s Picks filing uses:</span>
      {editing ? (
        <>
          <Input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} className="h-7 w-40 text-xs" />
          <Input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="h-7 w-56 text-xs" />
          <Button size="sm" className="h-7 text-xs" onClick={save}>
            Save
          </Button>
        </>
      ) : (
        <>
          <span>
            Username <span className="font-mono">{owner.username}</span> <Copy className="inline h-3 w-3 cursor-pointer" onClick={() => copy(owner.username)} />
          </span>
          <span>
            · Email <span className="font-mono">{owner.email}</span> <Copy className="inline h-3 w-3 cursor-pointer" onClick={() => copy(owner.email)} />
          </span>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setDraft(owner);
              setEditing(true);
            }}
          >
            Change
          </button>
        </>
      )}
    </section>
  );
}

/** One item's Today's Picks filing: automatic checklist, answers to copy, and "Mark filed". */
export function FilingCard({ filing, owner, onChanged }: { filing: FilingPackage; owner: OwnerDetails; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState(filing.fields);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const { ok, data } = await apiCall<{ error?: string; alreadyFiled?: boolean }>(FILING_URL, { method: "POST", body: { sku: filing.sku, ...body } });
      if (!ok) toast.error(data.error || "That didn't work");
      else toast.success(data.alreadyFiled ? "Already filed" : success);
      onChanged();
      return ok;
    } finally {
      setBusy(false);
    }
  }

  const saveEdits = async () => {
    const changed = Object.fromEntries(EDITABLE.map((k) => [k, fields[k]]));
    if (await post({ action: "edit", fields: changed }, "Answers saved")) setEditing(false);
  };

  return (
    <div className="space-y-2 rounded-md border bg-background p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Today&apos;s Picks</span>
        {filing.filed ? (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">
            Filed {new Date(filing.filed.at).toLocaleDateString("en-IN")} · {filing.filed.note ?? filing.filed.by}
          </span>
        ) : filing.ready ? (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">Ready to file</span>
        ) : (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">Not ready</span>
        )}
      </div>

      <ul className="grid gap-0.5 sm:grid-cols-2">
        {filing.checklist.map((c) => (
          <li key={c.label} className={`flex items-center gap-1 ${c.ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}`}>
            {c.ok ? <Check className="h-3 w-3 text-emerald-600" /> : <X className="h-3 w-3" />}
            {c.label}
          </li>
        ))}
      </ul>

      <div className="divide-y rounded border">
        {ROWS.map((r) => (
          <div key={r.key} className="flex items-start gap-2 p-1.5">
            <span className="w-48 shrink-0 text-muted-foreground">{r.label}</span>
            {editing && EDITABLE.includes(r.key) ? (
              <Input value={fields[r.key]} onChange={(e) => setFields({ ...fields, [r.key]: e.target.value })} className="h-7 text-xs" />
            ) : (
              <span className="flex-1 whitespace-pre-wrap break-all">{filing.fields[r.key] || <span className="text-muted-foreground">blank</span>}</span>
            )}
            {!editing && filing.fields[r.key] && <Copy className="mt-0.5 h-3 w-3 shrink-0 cursor-pointer" onClick={() => copy(filing.fields[r.key])} />}
          </div>
        ))}
      </div>

      {!filing.filed && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copy(asText(filing, owner), "All answers copied")}>
            <Copy className="mr-1 h-3 w-3" />
            Copy all
          </Button>
          <a href={FORM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline">
            Open Roblox form <ExternalLink className="ml-1 h-3 w-3" />
          </a>
          {editing ? (
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={saveEdits}>
              Save answers
            </Button>
          ) : (
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={() => {
                setFields(filing.fields);
                setEditing(true);
              }}
            >
              Edit answers
            </button>
          )}
          <span className="ml-auto flex items-center gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-7 w-44 text-xs" />
            <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => post({ action: "filed", by: "Arjun", note: note || null }, "Filed and logged in Marketing")}>
              Mark filed
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
