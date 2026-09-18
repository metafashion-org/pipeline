"use client";

import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Uploads one or more images straight into the team's Shared Drive (lib/assets/drive-upload.ts)
 * and hands back their links — the caller appends them to its own reference-links text, same as
 * if they'd been pasted by hand. Split out of asset-form-fields.tsx since it owns real state
 * (the file input ref, the uploading flag) that doesn't belong in that form's own state.
 */
export function ReferenceUploadButton({
  sku,
  disabled,
  onUploaded,
  onFilesSelected,
  onSettled,
}: {
  /** The SKU (real, or the create-dialog's previewed one) to file this upload under. */
  sku: string;
  /** True while the SKU preview hasn't loaded yet — nothing to upload against so far. */
  disabled?: boolean;
  onUploaded: (urls: string[]) => void;
  /**
   * Fires synchronously on file selection, before the network upload starts. A file Google Drive
   * only just received doesn't have a thumbnail yet — its thumbnail endpoint can lag or fail for
   * the first several seconds — so the caller uses this to show an instant local preview instead
   * of waiting on Drive.
   */
  onFilesSelected?: (files: File[]) => void;
  /** Fires once the whole batch has finished, success or failure, so the caller can clear those local previews either way. */
  onSettled?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    onFilesSelected?.(files);
    setUploading(true);
    const uploaded: string[] = [];
    try {
      for (const file of files) {
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
      onSettled?.();
    }
    if (uploaded.length > 0) {
      onUploaded(uploaded);
      toast.success(uploaded.length === 1 ? "Image uploaded" : `${uploaded.length} images uploaded`);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
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
        title={disabled ? "Waiting on the SKU to finish generating" : "Upload image files directly"}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
        {uploading ? "Uploading…" : "Upload"}
      </Button>
    </>
  );
}
