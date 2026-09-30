"use client";

import { useState } from "react";
import { toast } from "sonner";

/** What an upload route answers with: the file's link, plus its name and folder where the route gives them. */
export interface UploadedFileResponse {
  url: string;
  name?: string;
  folderUrl?: string;
}

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
 * Input: the SKU to file the upload under, and a callback for the links once uploaded. The
 * Curation form passes `uploadUrl` instead (app/api/curation/uploads/route.ts): an idea has no SKU
 * yet, and curators can't use the board's upload route. The Registry form also passes
 * `extraFields` (a recolor kit's name, so the images land in the kit's folder) and reads the
 * route's full answers from the callback's second argument.
 * Output: whether an upload is in flight, and the function that starts one from a list of files.
 */
export function useReferenceUpload({
  sku,
  uploadUrl = "/api/assets/reference-upload",
  extraFields,
  onUploaded,
}: {
  sku?: string;
  uploadUrl?: string;
  extraFields?: Record<string, string>;
  onUploaded: (urls: string[], responses: UploadedFileResponse[]) => void;
}) {
  const [uploading, setUploading] = useState(false);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    const uploaded: UploadedFileResponse[] = [];
    try {
      for (const file of files) {
        const body = new FormData();
        if (sku) body.append("sku", sku);
        for (const [key, value] of Object.entries(extraFields ?? {})) body.append(key, value);
        body.append("file", file);
        try {
          const res = await fetch(uploadUrl, { method: "POST", body });
          const data = await res.json();
          if (!res.ok) {
            toast.error(data.error || `Failed to upload ${file.name}`);
            continue;
          }
          uploaded.push({ url: data.url, name: data.name ?? file.name, folderUrl: data.folderUrl });
        } catch {
          toast.error(`Failed to upload ${file.name}`);
        }
      }
    } finally {
      setUploading(false);
    }
    if (uploaded.length > 0) {
      onUploaded(
        uploaded.map((u) => u.url),
        uploaded
      );
      toast.success(uploaded.length === 1 ? "File uploaded" : `${uploaded.length} files uploaded`);
    }
  }

  return { uploading, uploadFiles };
}
