"use client";

import { useRef } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A click-to-browse trigger for uploading reference files. Not image-only: a rig spec sheet, a
 * zipped texture pack or a PDF moodboard is as much an artist reference as a picture, and the
 * upload route (app/api/assets/reference-upload/route.ts) already accepts any file type.
 *
 * Purely presentational — `uploading` and `onFiles` are owned by the caller's own
 * useReferenceUpload() call, the same one ReferenceDropzone drives, so a file picked here and a
 * file dropped on the surrounding dropzone go through the same upload and the same "uploading"
 * state.
 */
export function ReferenceUploadButton({
  disabled,
  uploading,
  onFiles,
}: {
  /** True while the SKU preview hasn't loaded yet — nothing to upload against so far. */
  disabled?: boolean;
  uploading: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(fileList: FileList | null) {
    if (fileList && fileList.length > 0) onFiles(Array.from(fileList));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleChange(e.target.files)}
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
