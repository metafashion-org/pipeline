"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { apiCall } from "@/lib/api-client";
import { parseDriveRefs } from "@/lib/assets/drive-links";
import { toLinkText } from "@/lib/assets/file-store";
import { ReferenceDropzone } from "./reference-dropzone";
import { ReferenceUploadButton } from "./reference-upload-button";
import { DriveThumbnail } from "./drive-thumbnail";

// The board's own data (Board.tsx); refreshed so the card shows the new recolours.
const BOARD_DATA_URL = "/api/assets";

/**
 * Lets a curator attach recolour images to any card, or remove one. Each change saves at once
 * through PATCH /api/assets/[sku] with only recolorReferenceImages, which a curator may send for
 * any card; the change is recorded in the asset's history.
 */
export function RecolourAttach({ sku, recolorReferenceImages }: { sku: string; recolorReferenceImages: unknown }) {
  const { mutate } = useSWRConfig();
  const [links, setLinks] = useState(() => toLinkText(recolorReferenceImages));
  const [saving, setSaving] = useState(false);
  const refs = parseDriveRefs(links);

  async function save(next: string, message: string) {
    setSaving(true);
    try {
      const { ok, data } = await apiCall(`/api/assets/${encodeURIComponent(sku)}`, { method: "PATCH", body: { recolorReferenceImages: next } });
      if (!ok) {
        toast.error(data.error || "Couldn't save the recolours");
        return;
      }
      setLinks(next);
      toast.success(message);
      await mutate(BOARD_DATA_URL);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ReferenceDropzone sku={sku} onUploaded={(urls) => save([links, ...urls].filter(Boolean).join("\n"), "Recolours attached")}>
      {({ uploading, uploadFiles }) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Recolours</Label>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">or drop files here</span>
              <ReferenceUploadButton disabled={saving} uploading={uploading} onFiles={uploadFiles} />
            </div>
          </div>
          {refs.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {refs.map((ref) => (
                <DriveThumbnail
                  key={ref.url}
                  driveRef={ref}
                  size={64}
                  // Drops the exact line, as the edit form does, so other text on a line is never mangled.
                  onRemove={() => save(links.split("\n").filter((line) => line.trim() !== ref.url).join("\n"), "Recolour removed")}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No recolours attached yet.</p>
          )}
        </div>
      )}
    </ReferenceDropzone>
  );
}
