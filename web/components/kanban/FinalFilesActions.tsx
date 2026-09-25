"use client";

import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { UploadCloud, Send, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { apiCall } from "@/lib/api-client";

interface PickedFile {
  file: File;
  /** 0 to 1 while uploading; 1 once Drive has it. */
  progress: number;
  failed: boolean;
}

// Sends one file straight to Drive through the upload session this app opened for it, reporting
// progress. XMLHttpRequest rather than fetch: fetch can't report upload progress.
function uploadToDrive(uploadUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Drive answered ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("The upload was interrupted"));
    xhr.send(file);
  });
}

function formatSize(bytes: number): string {
  const MB = 1024 * 1024;
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * "Hand in final files", the brief's §8 handoff, for an Approved asset. Files are picked or
 * dropped here and go straight from the browser into the Shared Drive, in
 * "<SKU>/Final Files/v<N>/", so their size isn't limited by what a request to this app can carry.
 * Handing them in records each file and moves the asset to Ready for Upload. Allowed for the
 * asset's own artist, or the team on their behalf; the server checks both.
 */
export function SubmitFinalFilesDialog({ sku }: { sku: string }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutate } = useSWRConfig();

  function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const incoming = Array.from(files);
    setPicked((current) => {
      const names = new Set(current.map((p) => p.file.name));
      return [...current, ...incoming.filter((f) => !names.has(f.name)).map((file) => ({ file, progress: 0, failed: false }))];
    });
  }

  function setProgress(name: string, patch: Partial<PickedFile>) {
    setPicked((current) => current.map((p) => (p.file.name === name ? { ...p, ...patch } : p)));
  }

  async function handIn() {
    if (picked.length === 0) return;
    setBusy(true);
    try {
      let version: number | null = null;
      for (const { file } of picked) {
        setProgress(file.name, { progress: 0, failed: false });
        const session = await apiCall<{ uploadUrl: string; version: number }>(
          `/api/assets/${encodeURIComponent(sku)}/final-files/session`,
          { method: "POST", body: { fileName: file.name, mimeType: file.type || undefined, sizeBytes: file.size } }
        );
        if (!session.ok) {
          setProgress(file.name, { failed: true });
          toast.error(session.data.error || `Couldn't start uploading ${file.name}`);
          return;
        }
        version = session.data.version;
        try {
          await uploadToDrive(session.data.uploadUrl, file, (fraction) => setProgress(file.name, { progress: fraction }));
          setProgress(file.name, { progress: 1 });
        } catch (error) {
          setProgress(file.name, { failed: true });
          toast.error(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
          return;
        }
      }

      const { ok, data } = await apiCall(`/api/assets/${encodeURIComponent(sku)}/final-files`, {
        method: "POST",
        body: { version, fileNames: picked.map((p) => p.file.name), notes: notes.trim() || undefined },
      });
      if (!ok) {
        toast.error(data.error || "Couldn't hand in the files");
        return;
      }
      toast.success(`${sku}: final files handed in. It's now Ready for Upload.`);
      setOpen(false);
      setPicked([]);
      setNotes("");
      await Promise.all([mutate("/api/assets"), mutate(`/api/assets/${encodeURIComponent(sku)}/final-files`)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="submit-final-open">
          <UploadCloud className="h-3.5 w-3.5" />
          Hand in final files
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Hand in final files — {sku}</DialogTitle>
          <DialogDescription>
            The files go into the team Drive under {sku}/Final Files. Handing them in moves the asset to Ready for Upload.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggedOver(true);
            }}
            onDragLeave={() => setIsDraggedOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggedOver(false);
              if (!busy) addFiles(e.dataTransfer.files);
            }}
            className={`rounded-md border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors ${
              isDraggedOver ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            Drop files here, or click to choose
          </button>

          {picked.length > 0 && (
            <ul className="space-y-1.5 max-h-56 overflow-y-auto">
              {picked.map(({ file, progress, failed }) => (
                <li key={file.name} className="text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{file.name}</span>
                    <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                      {formatSize(file.size)}
                      {!busy && (
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => setPicked((current) => current.filter((p) => p.file.name !== file.name))}
                          className="hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="h-1 rounded bg-muted overflow-hidden">
                    <div
                      className={`h-full ${failed ? "bg-destructive" : "bg-primary"}`}
                      style={{ width: `${Math.round((failed ? 1 : progress) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-2">
            <Label htmlFor="final-notes">Notes (optional)</Label>
            <Textarea
              id="final-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the uploader should know"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button data-testid="submit-final-submit" onClick={handIn} disabled={busy || picked.length === 0}>
            {busy ? "Uploading..." : `Upload and hand in ${picked.length || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FinalFilesSubmission {
  version: number;
  folderUrl: string;
  submittedAt: string;
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
    <div className="space-y-2">
      {submissions.map((submission) => (
        <div key={submission.version} className="text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              Version {submission.version} · {formatDate(submission.submittedAt)}
            </span>
            <a href={submission.folderUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Open folder
            </a>
          </div>
          <ul className="space-y-0.5">
            {submission.files.map((file) => (
              <li key={file.id} className="flex justify-between gap-2">
                <a href={file.driveUrl} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                  {file.fileName}
                </a>
                {file.sizeBytes !== null && <span className="shrink-0 text-muted-foreground">{formatSize(file.sizeBytes)}</span>}
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
