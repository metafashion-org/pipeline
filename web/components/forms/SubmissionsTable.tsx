"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format-date";
import { labelForValue } from "@/lib/forms/field-options";
import type { FormFieldSpec } from "./form-field-spec";
import { ChevronDown, ChevronRight, Download } from "lucide-react";

interface SubmissionRow {
  id: string;
  submitterEmail: string | null;
  status: string;
  values: Record<string, unknown>;
  createdAt: string;
}

/**
 * Renders one stored answer as text.
 *
 * Input: the value out of form_submissions.values, and the field it was recorded under if that field still exists. Output: something readable.
 *
 * The stored value is the option's value, not its label, so a submission recorded as "small"
 * shows as "Small". A field that has since been removed has no options to look in, so the raw
 * value is shown — which is the point of keeping answers in JSONB rather than columns.
 */
function displayValue(raw: unknown, field: FormFieldSpec | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  const one = (v: unknown) => (field ? labelForValue(field.options, String(v)) : String(v));
  if (Array.isArray(raw)) return raw.length === 0 ? "—" : raw.map(one).join(", ");
  if (typeof raw === "object") return JSON.stringify(raw);
  return one(raw);
}

function toCsvCell(value: string): string {
  // Quote anything that would otherwise break the row, and double any quote inside it.
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * What people actually sent.
 *
 * This list used to show an email address, a status and a date, and nothing else — the answers
 * were in the response the page already had and were never rendered. Collecting responses you
 * cannot read is the whole feature missing its point.
 *
 * Input: the form's current fields, its submissions, and the form key for the export filename. Output: a searchable list, each row expandable to every answer, and a CSV export.
 */
export function SubmissionsTable({
  fields,
  submissions,
  formKey,
}: {
  fields: FormFieldSpec[];
  submissions: SubmissionRow[];
  formKey: string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.fieldKey, f])), [fields]);

  // Every key any submission was recorded under, not only the fields the form has now. A field
  // removed last month still has answers, and they still have to be readable.
  const allKeys = useMemo(() => {
    const keys = fields.map((f) => f.fieldKey);
    const seen = new Set(keys);
    for (const s of submissions) {
      for (const k of Object.keys(s.values || {})) {
        if (!seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
    return keys;
  }, [fields, submissions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return submissions;
    return submissions.filter((s) => {
      if (s.submitterEmail?.toLowerCase().includes(q)) return true;
      return Object.entries(s.values || {}).some(([key, value]) =>
        displayValue(value, fieldByKey.get(key)).toLowerCase().includes(q)
      );
    });
  }, [submissions, query, fieldByKey]);

  function exportCsv() {
    const header = ["Submitted at", "Submitted by", "Status", ...allKeys.map((k) => fieldByKey.get(k)?.label ?? k)];
    const rows = filtered.map((s) => [
      s.createdAt,
      s.submitterEmail ?? "",
      s.status,
      ...allKeys.map((k) => displayValue(s.values?.[k], fieldByKey.get(k))),
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => toCsvCell(String(c))).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formKey}-responses.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (submissions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">Nothing submitted yet.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search responses"
            className="max-w-xs"
          />
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {submissions.length}
          </span>
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5 ml-auto">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>

        <div className="space-y-1.5">
          {filtered.map((s) => {
            const open = expanded === s.id;
            return (
              <div key={s.id} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : s.id)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 rounded-lg transition-colors"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate flex-1">{s.submitterEmail || "No address recorded"}</span>
                  <Badge variant={s.status === "approved" ? "success" : s.status === "rejected" ? "destructive" : "secondary"}>
                    {s.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground shrink-0 hidden sm:inline">
                    {formatDateTime(s.createdAt)}
                  </span>
                </button>

                {open && (
                  <dl className="border-t border-border px-3 py-3 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,180px)_1fr]">
                    <dt className="text-muted-foreground sm:hidden font-medium">Submitted</dt>
                    <dt className="text-muted-foreground hidden sm:block">Submitted</dt>
                    <dd className="mb-1 sm:mb-0">{formatDateTime(s.createdAt)}</dd>
                    {allKeys.map((key) => {
                      const field = fieldByKey.get(key);
                      return (
                        <div key={key} className="contents">
                          <dt className="text-muted-foreground">
                            {field?.label ?? key}
                            {!field && <span className="ml-1 text-xs">(removed field)</span>}
                          </dt>
                          <dd className="mb-1 sm:mb-0 break-words">{displayValue(s.values?.[key], field)}</dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
