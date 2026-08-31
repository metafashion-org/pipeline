"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { UploadCloud, Send } from "lucide-react";
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

/**
 * "Submit Final Files" — the brief's §8 handoff, gated server-side (and
 * mirrored here for UX) to Approved-status assets, and to the assigned
 * artist or an admin/operator. One URL per line rather than a single field:
 * the brief describes a final files folder plus supporting deliverables, not
 * always exactly one link.
 */
export function SubmitFinalFilesDialog({ sku }: { sku: string }) {
  const [open, setOpen] = useState(false);
  const [fileUrlsText, setFileUrlsText] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { mutate } = useSWRConfig();

  async function submit() {
    const fileUrls = fileUrlsText.split("\n").map((u) => u.trim()).filter(Boolean);
    if (fileUrls.length === 0) {
      toast.error("At least one final file link is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/assets/${encodeURIComponent(sku)}/submit-final`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrls, notes: notes.trim() || undefined }),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error || "Failed to submit final files");
        return;
      }
      toast.success(`${sku} — final files submitted`);
      setOpen(false);
      setFileUrlsText("");
      setNotes("");
      mutate("/api/assets");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="submit-final-open">
          <UploadCloud className="h-3.5 w-3.5" />
          Submit final files
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Submit final files — {sku}</DialogTitle>
          <DialogDescription>
            One link per line (final folder, individual files, whatever applies). Moves this asset to Final Files Received.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label htmlFor="final-file-urls">File links</Label>
            <Textarea
              id="final-file-urls"
              rows={4}
              value={fileUrlsText}
              onChange={(e) => setFileUrlsText(e.target.value)}
              placeholder={"https://drive.google.com/...\nhttps://drive.google.com/..."}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="final-notes">Notes (optional)</Label>
            <Input id="final-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the reviewer should know" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button data-testid="submit-final-submit" onClick={submit} disabled={submitting}>
            {submitting ? "Submitting..." : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      const res = await fetch(`/api/assets/${encodeURIComponent(sku)}/notify-uploader`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      const result = await res.json();
      if (!res.ok) {
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
