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
import { toast } from "sonner";
import { Sparkles, History, Trash2, Loader2, Check } from "lucide-react";

interface FieldConfig {
  fieldKey: string;
  displayName: string;
  fieldType: string;
  options: string[];
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
      fieldValues,
    };
  }

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
        const res = await fetch("/api/curation/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(currentPayload()),
        });
        const data = await res.json();
        creatingRef.current = false;
        if (!res.ok) throw new Error(data.error);
        if (!activeRef.current) return;
        setDraftId(data.draft.id);
        draftIdRef.current = data.draft.id;
        onDraftChanged?.();
      } else {
        const res = await fetch(`/api/curation/drafts/${draftIdRef.current}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(currentPayload()),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
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
      const res = await fetch(`/api/curation/drafts/${draftId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
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
      const res = await fetch(`/api/curation/drafts/${draftId}/versions/${versionId}/restore`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const d = data.draft as DraftRecord;
      setIdeaTitle(d.ideaTitle);
      setCategory(d.category ?? "");
      setSourceLinks((d.sourceLinks ?? []).join(", "));
      setMoodboardUrls((d.moodboardUrls ?? []).join(", "));
      setFieldValues((d.fieldValues as Record<string, string>) ?? {});
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
      const res = await fetch("/api/curation/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...currentPayload(), draftId: draftId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit idea");

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
                  <AlertDialogDescription>This deletes it — there&apos;s no submitted idea to keep, since it was never submitted.</AlertDialogDescription>
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
          <label className="text-xs text-muted-foreground mb-1 block">Item Name / Curation Title *</label>
          <Input
            value={ideaTitle}
            onChange={(e) => {
              setIdeaTitle(e.target.value);
              scheduleSave();
            }}
            placeholder="e.g. Sakura Blossom Hair"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Category</label>
          <Input
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              scheduleSave();
            }}
            placeholder="e.g. Hair"
          />
        </div>

        {fields.map((f) => {
          const value = fieldValues[f.fieldKey] || "";
          return (
            <div key={f.fieldKey} className={f.fieldType === "textarea" ? "md:col-span-2" : ""}>
              <label className="text-xs text-muted-foreground mb-1 block">{f.displayName}</label>
              {f.fieldType === "textarea" && <Textarea value={value} onChange={(e) => setField(f.fieldKey, e.target.value)} rows={2} />}
              {f.fieldType === "select" && (
                <Select value={value} onValueChange={(v) => setField(f.fieldKey, v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${f.displayName.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {f.fieldType === "number" && (
                <Input type="number" value={value} onChange={(e) => setField(f.fieldKey, e.target.value)} />
              )}
              {!["textarea", "select", "number"].includes(f.fieldType) && (
                <Input value={value} onChange={(e) => setField(f.fieldKey, e.target.value)} />
              )}
            </div>
          );
        })}

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Source Links (comma-separated)</label>
          <Input
            value={sourceLinks}
            onChange={(e) => {
              setSourceLinks(e.target.value);
              scheduleSave();
            }}
            placeholder="https://..."
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Moodboard URLs (comma-separated)</label>
          <Input
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
          <DialogDescription>Every real save of this draft, most recent first. Restoring writes it back as a new version — nothing here gets erased.</DialogDescription>
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
    fetch(`/api/curation/drafts/${draftId}/versions`)
      .then((r) => r.json())
      .then((data) => setVersions(data.versions || []))
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
            <p className="text-xs text-muted-foreground">{new Date(v.savedAt).toLocaleString()}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => onRestore(v.id)} className="shrink-0">
            Restore
          </Button>
        </div>
      ))}
    </div>
  );
}
