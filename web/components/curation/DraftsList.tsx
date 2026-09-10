"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { FileEdit, Trash2, Inbox } from "lucide-react";
import { formatDateTime } from "@/lib/format-date";
import type { DraftRecord } from "./CurationIdeaForm";

export interface DraftListItem extends DraftRecord {
  updatedAt: string;
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// The other half of "no redundant drafts": this is where a curator actually
// SEES every idea they've got in progress at once (real parallel drafts,
// not the one-at-a-time Google Forms limit) and can tell at a glance which
// is which, rather than guessing whether they already started this one.
export function DraftsList({
  drafts,
  onResume,
  onChanged,
}: {
  drafts: DraftListItem[];
  onResume: (draft: DraftListItem) => void;
  onChanged: () => void;
}) {
  async function discard(id: string) {
    try {
      const res = await fetch(`/api/curation/drafts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Draft discarded");
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Couldn't discard draft"));
    }
  }

  if (drafts.length === 0) {
    return (
      <div className="max-w-5xl mx-auto text-center text-sm text-muted-foreground py-16">
        <Inbox className="h-8 w-8 mx-auto mb-3 opacity-50" />
        No drafts in progress. Start a new idea and it&apos;ll autosave here once you type something.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-2">
      {drafts.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium truncate">{d.ideaTitle || "Untitled idea"}</p>
              {d.category && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  {d.category}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs shrink-0">
                v{d.version}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Last saved {formatDateTime(d.updatedAt)}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="outline" onClick={() => onResume(d)}>
              <FileEdit className="h-3.5 w-3.5" /> Resume
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Discard &ldquo;{d.ideaTitle || "Untitled idea"}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>This deletes the draft and its whole version history. It was never submitted, so nothing else is affected.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => discard(d.id)}>Discard</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ))}
    </div>
  );
}
