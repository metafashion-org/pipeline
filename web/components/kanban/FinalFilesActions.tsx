"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { UploadCloud, Send } from "lucide-react";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { apiCall } from "@/lib/api-client";
import { formatFileSize } from "@/components/deliverables/drive-upload-client";
import { LinkifiedText } from "@/components/LinkifiedText";

/**
 * "Hand in final files" for an Approved asset: opens the Submit final files page with this asset
 * picked. Shown to the asset's artist and the team; the server checks both.
 */
export function HandInFinalFilesLink({ sku }: { sku: string }) {
  return (
    <Button size="sm" asChild data-testid="submit-final-open">
      <Link href={`/artist/submit?sku=${encodeURIComponent(sku)}`}>
        <UploadCloud className="h-3.5 w-3.5" />
        Hand in final files
      </Link>
    </Button>
  );
}

interface FinalFilesSubmission {
  version: number;
  folderUrl: string;
  submittedAt: string;
  comments: string | null;
  submittedBy: string | null;
  files: { id: string; fileName: string; sizeBytes: number | null; driveUrl: string }[];
}

/**
 * The asset's final-files submissions, newest first: each version's files and a link to its Drive
 * folder. Hidden until something has been handed in.
 */
export function FinalFilesList({ sku, enabled }: { sku: string; enabled: boolean }) {
  const key = enabled ? `/api/assets/${encodeURIComponent(sku)}/final-files` : null;
  const { data } = useSWR<{ submissions: FinalFilesSubmission[] }>(key, jsonFetcher);
  const submissions = data?.submissions ?? [];
  if (submissions.length === 0) return null;

  return (
    <div className="space-y-3">
      {submissions.map((submission) => (
        <div key={submission.version} className="text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              Version {submission.version} · {formatDate(submission.submittedAt)}
              {submission.submittedBy ? ` · ${submission.submittedBy}` : ""}
            </span>
            <a href={submission.folderUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Open folder
            </a>
          </div>
          {submission.comments && <p className="text-muted-foreground whitespace-pre-line">&ldquo;<LinkifiedText text={submission.comments} />&rdquo;</p>}
          <ul className="space-y-0.5">
            {submission.files.map((file) => (
              <li key={file.id} className="flex justify-between gap-2">
                <a href={file.driveUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                  {file.fileName}
                </a>
                {file.sizeBytes !== null && <span className="shrink-0 text-muted-foreground">{formatFileSize(file.sizeBytes)}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * "Notify Uploader" — the brief's §5 transition trigger. Admin/operator
 * only, gated on canAssignPublisher (same as this codebase's other
 * production-handoff actions). Moves the asset into the shared Ready for
 * Upload queue that /publisher reads from.
 */
export function NotifyUploaderButton({ sku }: { sku: string }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { mutate } = useSWRConfig();

  async function submit() {
    setSubmitting(true);
    try {
      const { ok, data: result } = await apiCall(`/api/assets/${encodeURIComponent(sku)}/notify-uploader`, {
        method: "POST",
        body: { notes: notes.trim() || undefined },
      });
      if (!ok) {
        toast.error(result.error || "Failed to notify uploader");
        return;
      }
      toast.success(`${sku} — uploader notified, now Ready for Upload`);
      setOpen(false);
      setNotes("");
      mutate("/api/assets");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid="notify-uploader-open">
          <Send className="h-3.5 w-3.5" />
          Notify uploader
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Notify uploader — {sku}</DialogTitle>
          <DialogDescription>
            Puts this asset in the shared Ready for Upload queue with its SKU, item name, and final files.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="notify-notes">Instructions (optional)</Label>
          <Input id="notify-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any upload instructions" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button data-testid="notify-uploader-submit" onClick={submit} disabled={submitting}>
            {submitting ? "Notifying..." : "Notify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
