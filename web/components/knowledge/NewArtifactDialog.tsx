"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { ARTIFACT_FORMS, formForPrefix } from "@/lib/knowledge/artifact-forms";
import type { RegistryArtifactView } from "@/lib/dashboard/views";
import { ArtifactFieldInput } from "./artifact-field-input";

export interface ArtifactTypeOption {
  id: string;
  prefix: string;
  label: string;
  isActive: boolean;
}

// A type with a form of its own is listed in ARTIFACT_FORMS order; any other active type follows.
function orderTypes(types: ArtifactTypeOption[]): ArtifactTypeOption[] {
  const active = types.filter((t) => t.isActive);
  const rank = (prefix: string) => {
    const index = ARTIFACT_FORMS.findIndex((form) => form.prefix === prefix);
    return index === -1 ? ARTIFACT_FORMS.length : index;
  };
  return [...active].sort((a, b) => rank(a.prefix) - rank(b.prefix));
}

/**
 * The Registry's New Artifact form. Picking a type shows only that type's fields
 * (lib/knowledge/artifact-forms.ts); the server checks the same fields before saving.
 */
export function NewArtifactDialog({
  types,
  trendBriefs,
  onCreated,
}: {
  types: ArtifactTypeOption[];
  /** The Registry's Trend Briefs, for the "Trend it came from" picker. */
  trendBriefs: RegistryArtifactView[];
  onCreated: (artifactId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const { data: categoriesData } = useSWR<{ categories?: { name: string }[] }>(open ? "/api/admin/categories" : null, jsonFetcher);

  const orderedTypes = useMemo(() => orderTypes(types), [types]);
  const type = orderedTypes.find((t) => t.id === typeId) ?? null;
  const form = type ? formForPrefix(type.prefix) : null;
  const options = {
    categories: (categoriesData?.categories ?? []).map((c) => c.name),
    trends: trendBriefs.map((t) => ({ id: t.id, label: `${t.artifactId} · ${t.title}` })),
    kitName: typeof values.title === "string" ? values.title : "",
  };

  function reset() {
    setTypeId(null);
    setValues({});
  }

  function handleOpenChange(next: boolean) {
    // Cleared on the way in rather than out, so the closing animation doesn't flash the type picker.
    if (next) reset();
    setOpen(next);
  }

  async function submit() {
    if (!type || !form) return;
    const missing = form.fields.find((field) => {
      const value = values[field.key];
      return field.required && (value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0));
    });
    if (missing) {
      toast.error(`${missing.label} is required`);
      return;
    }
    setSubmitting(true);
    try {
      const { ok, data } = await apiCall<{ artifact: { artifactId: string } }>("/api/admin/knowledge/artifacts", {
        method: "POST",
        body: { artifactTypeId: type.id, values },
      });
      if (!ok) {
        toast.error(data.error || "Couldn't add it to the Registry");
        return;
      }
      toast.success(`Added ${data.artifact.artifactId}`);
      onCreated(data.artifact.artifactId);
      handleOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> New artifact
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{type ? `New ${type.label}` : "What are you adding?"}</DialogTitle>
          <DialogDescription>
            {type ? form?.summary || "It gets a permanent ID when you add it." : "Pick a type. The form only asks for what that type needs."}
          </DialogDescription>
        </DialogHeader>

        {!type && (
          <div className="grid gap-2">
            {orderedTypes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTypeId(t.id)}
                className="rounded-md border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{t.prefix}</span>
                </span>
                {formForPrefix(t.prefix).summary && <span className="mt-0.5 block text-xs text-muted-foreground">{formForPrefix(t.prefix).summary}</span>}
              </button>
            ))}
          </div>
        )}

        {type && form && (
          <div className="space-y-3">
            {form.fields.map((field) => (
              <ArtifactFieldInput
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
                options={options}
              />
            ))}
          </div>
        )}

        {type && (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={reset} disabled={submitting}>
              <ArrowLeft className="h-4 w-4" /> Change type
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Adding..." : "Add to Registry"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
