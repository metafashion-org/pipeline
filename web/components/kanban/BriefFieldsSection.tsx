"use client";

import useSWR from "swr";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { jsonFetcher } from "@/lib/fetcher";

interface FormField {
  fieldKey: string;
  displayName: string;
  fieldType: string;
  options: string[] | null;
  includeInArtistEmail: boolean;
  appliesToCategories: string[] | null;
}

// A select can't hold an empty value, so "not set" is this.
const NOT_SET = "__not_set__";

/**
 * The brief fields from Settings > Curation fields (rig, technical specs, target wearer, notes...),
 * the ones the retired Curation form asked for. Fields marked for the artist go into their brief
 * email; the rest are for the team. Deadline, budget and recolours have their own inputs above.
 */
export function BriefFieldsSection({
  values,
  onChange,
  category,
  idPrefix,
}: {
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  category: string;
  idPrefix: string;
}) {
  const { data } = useSWR<{ formFields: FormField[] }>("/api/admin/curation-fields", jsonFetcher);
  const fields = (data?.formFields ?? []).filter((f) => !f.appliesToCategories || f.appliesToCategories.length === 0 || f.appliesToCategories.includes(category));
  if (fields.length === 0) return null;

  const set = (key: string, value: string) => onChange({ ...values, [key]: value });
  const groups = [
    { title: "Brief for the artist", hint: "Goes in the artist's brief email.", fields: fields.filter((f) => f.includeInArtistEmail) },
    { title: "For the team", hint: "Not shown to the artist.", fields: fields.filter((f) => !f.includeInArtistEmail) },
  ].filter((g) => g.fields.length > 0);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.title} className="space-y-2">
          <div>
            <p className="text-sm font-medium">{group.title}</p>
            <p className="text-xs text-muted-foreground">{group.hint}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.fields.map((f) => {
              const id = `${idPrefix}-brief-${f.fieldKey}`;
              const value = values[f.fieldKey] ?? "";
              return (
                <div key={f.fieldKey} className={f.fieldType === "textarea" ? "space-y-1 sm:col-span-2" : "space-y-1"}>
                  <Label htmlFor={id} className="text-xs">
                    {f.displayName}
                  </Label>
                  {f.fieldType === "textarea" ? (
                    <Textarea id={id} rows={2} value={value} onChange={(e) => set(f.fieldKey, e.target.value)} />
                  ) : f.fieldType === "select" && (f.options?.length ?? 0) > 0 ? (
                    <Select value={value || NOT_SET} onValueChange={(v) => set(f.fieldKey, v === NOT_SET ? "" : v)}>
                      <SelectTrigger id={id} className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NOT_SET}>Not set</SelectItem>
                        {f.options!.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input id={id} type={f.fieldType === "number" ? "number" : "text"} value={value} onChange={(e) => set(f.fieldKey, e.target.value)} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
