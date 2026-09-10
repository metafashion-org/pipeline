"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiCall } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format-date";
import type { FieldOption } from "@/lib/forms/field-options";
import { toast } from "sonner";
import { Sparkles, History, Trash2, Loader2, Check } from "lucide-react";

interface FieldConfig {
  fieldKey: string;
  displayName: string;
  fieldType: string;
  options: FieldOption[];
  // null or empty means the field applies to every category.
  appliesToCategories: string[] | null;
}

export interface DraftRecord {
  id: string;
  ideaTitle: string;
  category: string | null;
  sourceLinks: string[];
  moodboardUrls: string[];
  fieldValues: Record<string, unknown>;
  version: number;
}

interface DraftVersion {
  id: string;
  version: number;
  ideaTitle: string;
  savedAt: string;
}

const AUTOSAVE_DEBOUNCE_MS = 2000;

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * The curation idea form — the brief's §6 entry point, flow-state layout
 * (every field visible in a grid, fillable in any order). Now backed by
 * real parallel drafts + version history (lib/curation/draft-service.ts):
 * a draft row is created on the first real edit (never on a blank visit),
 * every further change autosaves to that SAME row (no duplicate drafts),
 * and each meaningful save is throttled into a real, browsable version
 * history rather than one entry per keystroke.
 */
export function CurationIdeaForm({
  fields,
  initialDraft,
  onDraftChanged,
}: {
  fields: FieldConfig[];
  initialDraft?: DraftRecord | null;
  onDraftChanged?: () => void;
}) {
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const [ideaTitle, setIdeaTitle] = useState(initialDraft?.ideaTitle ?? "");
  const [category, setCategory] = useState(initialDraft?.category ?? "");
  const [sourceLinks, setSourceLinks] = useState((initialDraft?.sourceLinks ?? []).join(", "));
  const [moodboardUrls, setMoodboardUrls] = useState((initialDraft?.moodboardUrls ?? []).join(", "));
  // Budget and Deadline are first-class typed columns on `assets` (fee_amount numeric, deadline
  // timestamptz) that payment cycles and the board sort on, so they are collected as their own
  // typed inputs rather than as dynamic fields writing strings into field_values. Drafts saved
  // before that carry them inside fieldValues, so they are read from there as a starting value.
  // Lazy initializers: the argument form would recompute these on every render and throw the
  // result away, since useState only reads it once.
  const [budget, setBudget] = useState(() => String((initialDraft?.fieldValues as Record<string, unknown>)?.budget ?? ""));
  const [deadline, setDeadline] = useState(() => String((initialDraft?.fieldValues as Record<string, unknown>)?.deadline ?? ""));
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(
    (initialDraft?.fieldValues as Record<string, string>) ?? {}
  );
  const [submitting, setSubmitting] = useState(false);
  const [lastCreated, setLastCreated] = useState<{ sku: string; ideaTitle: string } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(initialDraft ? "saved" : "idle");
  const [historyOpen, setHistoryOpen] = useState(false);

  // Guards against the debounced autosave firing after a submit/discard has
  // already moved the form on to something else, and against two overlapping
  // "create the draft" calls racing each other on rapid first keystrokes.
  const draftIdRef = useRef(draftId);
  // Mirrored in an effect, not written directly during render — refs are
  // meant to be read/written outside of render (event handlers, effects),
  // and persist() (an event-handler-triggered async function) needs the
  // latest id, not whatever was current when the debounce timer was set.
  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);
  const creatingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const setField = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
    scheduleSave();
  };

  function currentPayload() {
    return {
      ideaTitle: ideaTitle.trim() || "Untitled idea",
      category: category.trim() || null,
      sourceLinks: sourceLinks.split(",").map((s) => s.trim()).filter(Boolean),
      moodboardUrls: moodboardUrls.split(",").map((s) => s.trim()).filter(Boolean),
      budget: budget.trim(),
      deadline: deadline.trim(),
      // Also folded into fieldValues so the draft row round-trips them: a draft is scratch
      // space keyed by field, and the restore path above reads them back from here. Only the
      // top-level values above are used on submit, where they go to the asset's typed columns.
      fieldValues: { ...fieldValues, budget: budget.trim(), deadline: deadline.trim() },
    };
  }

  /**
   * The dynamic fields that belong on this form given the category being curated.
   *
   * Input: nothing — reads the configured fields and the current category. Output: the fields to render.
   * A field with no configured categories applies everywhere, which is what every field meant
   * before scoping existed. With no category chosen yet, everything shows, so the form is never
   * mysteriously empty while someone is still deciding what they are curating.
   */
  const visibleFields = (() => {
    const chosen = category.trim().toLowerCase();
    if (!chosen) return fields;
    return fields.filter(
      (f) => !f.appliesToCategories || f.appliesToCategories.length === 0 ||
        f.appliesToCategories.some((c) => c.trim().toLowerCase() === chosen)
    );
  })();

  // Creates the draft row lazily, on the first real edit only — a blank,
  // never-touched form never leaves a phantom draft behind. Every edit
  // after that debounces into a save against the SAME row.
  function scheduleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState("idle");
    saveTimerRef.current = setTimeout(() => {
      void persist();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function persist() {
    if (creatingRef.current) return;
    setSaveState("saving");
    try {
      if (!draftIdRef.current) {
        creatingRef.current = true;
        const { ok, data } = await apiCall<{ draft: { id: string } }>("/api/curation/drafts", { method: "POST", body: currentPayload() });
        creatingRef.current = false;
        if (!ok) throw new Error(data.error);
        if (!activeRef.current) return;
        setDraftId(data.draft.id);
        draftIdRef.current = data.draft.id;
        onDraftChanged?.();
      } else {
        const { ok, data } = await apiCall(`/api/curation/drafts/${draftIdRef.current}`, { method: "PATCH", body: currentPayload() });
        if (!ok) throw new Error(data.error);
        onDraftChanged?.();
      }
      if (activeRef.current) setSaveState("saved");
    } catch (e) {
      creatingRef.current = false;
      if (activeRef.current) {
        setSaveState("idle");
        toast.error(errMessage(e, "Couldn't save draft"));
      }
    }
  }

  function resetForm() {
    setDraftId(null);
    draftIdRef.current = null;
    setIdeaTitle("");
    setCategory("");
    setSourceLinks("");
    setMoodboardUrls("");
    setFieldValues({});
    setSaveState("idle");
  }

  async function discard() {
    if (!draftId) {
      resetForm();
      return;
    }
    try {
      const { ok, data } = await apiCall(`/api/curation/drafts/${draftId}`, { method: "DELETE" });
      if (!ok) throw new Error(data.error);
      toast.success("Draft discarded");
      onDraftChanged?.();
      resetForm();
    } catch (e) {
      toast.error(errMessage(e, "Couldn't discard draft"));
    }
  }

  async function restoreVersion(versionId: string) {
    if (!draftId) return;
    try {
      const { ok, data } = await apiCall(`/api/curation/drafts/${draftId}/versions/${versionId}/restore`, { method: "POST" });
      if (!ok) throw new Error(data.error);
      const d = data.draft as DraftRecord;
      setIdeaTitle(d.ideaTitle);
      setCategory(d.category ?? "");
      setSourceLinks((d.sourceLinks ?? []).join(", "));
      setMoodboardUrls((d.moodboardUrls ?? []).join(", "));
      setFieldValues((d.fieldValues as Record<string, string>) ?? {});
      setBudget(String((d.fieldValues as Record<string, unknown>)?.budget ?? ""));
      setDeadline(String((d.fieldValues as Record<string, unknown>)?.deadline ?? ""));
      setSaveState("saved");
      setHistoryOpen(false);
      toast.success(`Restored version ${d.version}`);
      onDraftChanged?.();
    } catch (e) {
      toast.error(errMessage(e, "Couldn't restore that version"));
    }
  }

  const handleSubmit = async () => {
    if (!ideaTitle.trim()) {
      toast.error("Item name / curation title is required");
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSubmitting(true);
    try {
      const { ok, data } = await apiCall<{ sku: string; idea: { ideaTitle: string } }>("/api/curation/ideas", { method: "POST", body: { ...currentPayload(), draftId: draftId || undefined } });
      if (!ok) throw new Error(data.error || "Failed to submit idea");

      setLastCreated({ sku: data.sku, ideaTitle: data.idea.ideaTitle });
      toast.success(`Created ${data.sku} — now on the board, Unassigned`);
      onDraftChanged?.();
      resetForm();
    } catch (e) {
      toast.error(errMessage(e, "Failed to submit idea"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {lastCreated && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <span>
            <strong className="font-mono">{lastCreated.sku}</strong> — &ldquo;{lastCreated.ideaTitle}&rdquo; created. It&apos;s on the Kanban board now, Unassigned.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground min-h-[20px]">
        <div className="flex items-center gap-1.5">
          {saveState === "saving" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Saving draft…
            </>
          )}
          {saveState === "saved" && (
            <>
              <Check className="h-3 w-3 text-primary" /> Draft saved
            </>
          )}
        </div>
        {draftId && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => setHistoryOpen(true)}>
              <History className="h-3 w-3" /> Version history
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" /> Discard
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
                  <AlertDialogDescription>It was never submitted, so there is nothing to keep. This deletes it.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={discard}>Discard</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* Everything visible at once, fillable in any order — the point of
          this layout. Nothing here gates on a prior field being filled. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label htmlFor="curation-idea-title" className="text-xs text-muted-foreground mb-1 block">Item Name / Curation Title *</label>
          <Input
            id="curation-idea-title"
            value={ideaTitle}
            onChange={(e) => {
              setIdeaTitle(e.target.value);
              scheduleSave();
            }}
            placeholder="e.g. Sakura Blossom Hair"
          />
        </div>

        <div>
          <label htmlFor="curation-category" className="text-xs text-muted-foreground mb-1 block">Category</label>
          <Input
            id="curation-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              scheduleSave();
            }}
            placeholder="e.g. Hair"
          />
        </div>

        <div>
          <label htmlFor="curation-budget" className="text-xs text-muted-foreground mb-1 block">Budget / Fee</label>
          <Input
            id="curation-budget"
            type="number"
            min="0"
            step="0.01"
            value={budget}
            onChange={(e) => {
              setBudget(e.target.value);
              scheduleSave();
            }}
            placeholder="e.g. 5000"
          />
        </div>

        <div>
          <label htmlFor="curation-deadline" className="text-xs text-muted-foreground mb-1 block">Deadline</label>
          {/* Native date input rather than a picker dependency — it is a real date type on the
              asset, and the browser already knows how to enter one. */}
          <Input
            id="curation-deadline"
            type="date"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              scheduleSave();
            }}
          />
        </div>

        {visibleFields.map((f) => {
          const value = fieldValues[f.fieldKey] || "";
          // A select whose options were never configured renders a free-text input instead of an
          // empty dropdown, so the field is still answerable.
          const isChoice = f.fieldType === "select" && f.options.length > 0;
          return (
            <div key={f.fieldKey} className={f.fieldType === "textarea" ? "md:col-span-2" : ""}>
              <label htmlFor={`curation-field-${f.fieldKey}`} className="text-xs text-muted-foreground mb-1 block">{f.displayName}</label>
              {f.fieldType === "textarea" && <Textarea id={`curation-field-${f.fieldKey}`} value={value} onChange={(e) => setField(f.fieldKey, e.target.value)} rows={2} />}
              {isChoice && (
                <Select value={value} onValueChange={(v) => setField(f.fieldKey, v)}>
                  <SelectTrigger id={`curation-field-${f.fieldKey}`}>
                    <SelectValue placeholder={`Select ${f.displayName.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {f.fieldType === "number" && (
                <Input id={`curation-field-${f.fieldKey}`} type="number" value={value} onChange={(e) => setField(f.fieldKey, e.target.value)} />
              )}
              {f.fieldType !== "textarea" && f.fieldType !== "number" && !isChoice && (
                <Input id={`curation-field-${f.fieldKey}`} value={value} onChange={(e) => setField(f.fieldKey, e.target.value)} />
              )}
            </div>
          );
        })}

        <div>
          <label htmlFor="curation-source-links" className="text-xs text-muted-foreground mb-1 block">Source Links (comma-separated)</label>
          <Input
            id="curation-source-links"
            value={sourceLinks}
            onChange={(e) => {
              setSourceLinks(e.target.value);
              scheduleSave();
            }}
            placeholder="https://..."
          />
        </div>
        <div>
          <label htmlFor="curation-moodboard-urls" className="text-xs text-muted-foreground mb-1 block">Moodboard URLs (comma-separated)</label>
          <Input
            id="curation-moodboard-urls"
            value={moodboardUrls}
            onChange={(e) => {
              setMoodboardUrls(e.target.value);
              scheduleSave();
            }}
            placeholder="https://..."
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Creating..." : "Submit Idea"}
        </Button>
      </div>

      {draftId && (
        <VersionHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} draftId={draftId} onRestore={restoreVersion} />
      )}
    </div>
  );
}

function VersionHistoryDialog({
  open,
  onOpenChange,
  draftId,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftId: string;
  onRestore: (versionId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>Every save of this draft, most recent first. Restoring writes the old version back as a new one, so nothing is erased.</DialogDescription>
        </DialogHeader>
        {/* Mounted fresh only while actually open, so its own loading state
            can just start true (see VersionHistoryList) instead of needing
            a setState at the top of an effect to reset it on every reopen. */}
        {open && <VersionHistoryList draftId={draftId} onRestore={onRestore} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionHistoryList({ draftId, onRestore }: { draftId: string; onRestore: (versionId: string) => void }) {
  const [versions, setVersions] = useState<DraftVersion[] | null>(null);

  useEffect(() => {
    apiCall<{ versions: DraftVersion[] }>(`/api/curation/drafts/${draftId}/versions`)
      .then(({ ok, data }) => setVersions(ok ? data.versions || [] : []))
      .catch(() => setVersions([]));
  }, [draftId]);

  return (
    <div className="max-h-80 overflow-y-auto space-y-1.5">
      {versions === null && <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>}
      {versions?.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No saved versions yet.</p>}
      {versions?.map((v) => (
        <div key={v.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="font-medium truncate">
              v{v.version} — {v.ideaTitle}
            </p>
            <p className="text-xs text-muted-foreground">{formatDateTime(v.savedAt)}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => onRestore(v.id)} className="shrink-0">
            Restore
          </Button>
        </div>
      ))}
    </div>
  );
}
