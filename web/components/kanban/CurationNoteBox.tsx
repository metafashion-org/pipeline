"use client";

import { useState } from "react";
import { mutate } from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiCall } from "@/lib/api-client";
import { CURATION_NOTE_KEY, CURATION_NOTE_PROMPT } from "@/lib/assets/curation-note";

const BOARD_DATA_URL = "/api/assets";

/**
 * The comment on how an asset's Registry links come together, under the links in the asset drawer,
 * so attaching one there has somewhere to explain it. People who can edit the asset write and save
 * it here; everyone else reads it. Saved into the asset's brief fields, like the box on New Asset.
 */
export function CurationNoteBox({ sku, briefFields, canEdit }: { sku: string; briefFields: Record<string, string>; canEdit: boolean }) {
  const saved = briefFields[CURATION_NOTE_KEY] ?? "";
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);

  if (!canEdit) {
    if (!saved) return null;
    return (
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs whitespace-pre-wrap">
        <span className="font-medium">How these come together: </span>
        {saved}
      </p>
    );
  }

  async function save() {
    setSaving(true);
    try {
      // The PATCH replaces all brief fields, so the others go along unchanged.
      const { ok, data } = await apiCall(`/api/assets/${encodeURIComponent(sku)}`, {
        method: "PATCH",
        body: { briefFields: { ...briefFields, [CURATION_NOTE_KEY]: draft } },
      });
      if (!ok) {
        toast.error(data.error || "Couldn't save the comment");
        return;
      }
      toast.success("Comment saved");
      await mutate(BOARD_DATA_URL);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${sku}-curation-note`} className="text-xs">
        How do these come together?
      </Label>
      <Textarea id={`${sku}-curation-note`} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={CURATION_NOTE_PROMPT} className="text-xs" />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">For the team and Arjun&apos;s sign-off. Not shown to the artist.</p>
        <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving || draft.trim() === saved.trim()}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
