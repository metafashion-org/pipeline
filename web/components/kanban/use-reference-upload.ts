"use client";

import { useState } from "react";
import { toast } from "sonner";

/**
 * Uploads one or more files straight into the team's Shared Drive
 * (POST /api/assets/reference-upload, see lib/assets/drive-upload.ts) and hands back their
 * links — the caller appends them to its own reference-links text, same as if they'd been pasted
 * by hand.
 *
 * Shared by ReferenceUploadButton (a click-to-browse file input) and ReferenceDropzone
 * (drag-and-drop) so both end up going through the same upload, the same toasts and the same
 * "uploading" state, whichever one the person used.
 *
 * Input: the SKU to file the upload under, and a callback for the links once uploaded.
 * Output: whether an upload is in flight, and the function that starts one from a list of files.
 */
export function useReferenceUpload({
  sku,
  onUploaded,
}: {
  sku: string;
  onUploaded: (urls: string[]) => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
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
    }
    if (uploaded.length > 0) {
      onUploaded(uploaded);
      toast.success(uploaded.length === 1 ? "File uploaded" : `${uploaded.length} files uploaded`);
    }
  }

  return { uploading, uploadFiles };
}
