"use client";

import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, FileEdit } from "lucide-react";
import { CurationIdeaForm, type DraftRecord } from "./CurationIdeaForm";
import { DraftsList, type DraftListItem } from "./DraftsList";

interface FieldConfig {
  fieldKey: string;
  displayName: string;
  fieldType: string;
  options: string[];
}

// Ties the flow-state form to the parallel-drafts list: "New Idea" always
// starts blank (a fresh draft is only created once something's actually
// typed - see CurationIdeaForm), "My Drafts" shows every idea already in
// progress. Resuming one switches tabs AND hands that exact draft's data
// to the same form component, so there's one form, not two code paths for
// "new" vs "editing."
export function CurationWorkspace({ fields, initialDrafts = [] }: { fields: FieldConfig[]; initialDrafts?: DraftListItem[] }) {
  const [tab, setTab] = useState<"new" | "drafts">("new");
  const [drafts, setDrafts] = useState<DraftListItem[]>(initialDrafts);
  const [resumeDraft, setResumeDraft] = useState<DraftRecord | null>(null);
  // Remounts the form on every "start fresh" transition (new tab click,
  // post-submit, post-discard) so its internal state resets cleanly
  // instead of trying to hand-reset a dozen pieces of state itself.
  const [formKey, setFormKey] = useState(0);

  // The server already renders the real initial list (see the curator
  // page), so this only needs to run again after something actually
  // changes (a save/submit/discard, via onDraftChanged below) — not on
  // every mount, which would just be a redundant refetch of what was
  // already rendered server-side.
  const refreshDrafts = useCallback(async () => {
    try {
      const res = await fetch("/api/curation/drafts");
      const data = await res.json();
      if (res.ok) setDrafts(data.drafts || []);
    } catch {
      // A failed background refresh isn't worth surfacing an error toast for.
    }
  }, []);

  function startNew() {
    setResumeDraft(null);
    setFormKey((k) => k + 1);
    setTab("new");
  }

  function resume(draft: DraftListItem) {
    setResumeDraft(draft);
    setFormKey((k) => k + 1);
    setTab("new");
  }

  // CurationIdeaForm calls this after every save, submit, and discard - one
  // callback covers all three, since the drafts list needs refreshing
  // after each regardless of which one just happened.
  function onDraftChanged() {
    void refreshDrafts();
  }

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "new" | "drafts")} className="max-w-5xl mx-auto gap-4">
      <TabsList>
        <TabsTrigger value="new" onClick={() => tab !== "new" && startNew()}>
          <PlusCircle className="h-3.5 w-3.5" /> New Idea
        </TabsTrigger>
        <TabsTrigger value="drafts">
          <FileEdit className="h-3.5 w-3.5" /> My Drafts
          {drafts.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px]">
              {drafts.length}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="new">
        <CurationIdeaForm key={formKey} fields={fields} initialDraft={resumeDraft} onDraftChanged={onDraftChanged} />
      </TabsContent>

      <TabsContent value="drafts">
        <DraftsList drafts={drafts} onResume={resume} onChanged={onDraftChanged} />
      </TabsContent>
    </Tabs>
  );
}
