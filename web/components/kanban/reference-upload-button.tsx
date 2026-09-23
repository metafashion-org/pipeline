"use client";

import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Uploads one or more files straight into the team's Shared Drive (lib/assets/drive-upload.ts)
 * and hands back their links — the caller appends them to its own reference-links text, same as
 * if they'd been pasted by hand. Split out of asset-form-fields.tsx since it owns real state
 * (the file input ref, the uploading flag) that doesn't belong in that form's own state.
 *
 * Not image-only: a rig spec sheet, a zipped texture pack or a PDF moodboard is as much an
 * artist reference as a picture, and the upload route (app/api/assets/reference-upload/route.ts)
 * already accepts any file type — only this component's own `accept` used to narrow it down.
 */
export function ReferenceUploadButton({
  sku,
  disabled,
  onUploaded,
}: {
  /** The SKU (real, or the create-dialog's previewed one) to file this upload under. */
  sku: string;
  /** True while the SKU preview hasn't loaded yet — nothing to upload against so far. */
  disabled?: boolean;
  onUploaded: (urls: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    const uploaded: string[] = [];
    try {
      for (const file of Array.from(fileList)) {
        const body = new FormData();
        body.append("sku", sku);
        body.append("file", file);
        try {
          const res = await fetch("/api/assets/reference-upload", { method: "POST", body });
          const data = await res.json();
          if (!res.ok) {
            toast.error(data.error || `Failed to upload ${file.name}`);
            continue;
          }
          uploaded.push(data.url);
        } catch {
          toast.error(`Failed to upload ${file.name}`);
        }
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
    if (uploaded.length > 0) {
      onUploaded(uploaded);
      toast.success(uploaded.length === 1 ? "File uploaded" : `${uploaded.length} files uploaded`);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs gap-1"
        disabled={disabled || uploading}
        title={disabled ? "Waiting on the SKU to finish generating" : "Upload images, PDFs, zips or any other reference file"}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
        {uploading ? "Uploading…" : "Upload"}
      </Button>
    </>
  );
}
