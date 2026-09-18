"use client";

import { ExternalLink, X } from "lucide-react";
import { DriveImage } from "./drive-image";
import type { DriveRef } from "@/lib/assets/drive-links";

/**
 * Shown when a reference has no fetchable file behind it — a Drive folder link, a non-Drive URL,
 * or a file the thumbnail endpoint couldn't load — so a reference is never silently dropped.
 */
const OPEN_IN_DRIVE = (
  <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-xs text-muted-foreground">
    <ExternalLink className="h-3.5 w-3.5" />
    Open in Drive
  </span>
);

/**
 * One Drive reference, shown as a thumbnail linking out to the file. Shared by the asset drawer's
 * read-only gallery and the create/edit form's editable one — `onRemove` is what tells them apart:
 * the drawer passes none, the form passes a handler and gets a hover-revealed remove button.
 */
export function DriveThumbnail({
  driveRef,
  size = 96,
  onRemove,
}: {
  driveRef: DriveRef;
  /** Side length in pixels. Defaults to the drawer's own read-only gallery size. */
  size?: number;
  onRemove?: () => void;
}) {
  return (
    <a
      href={driveRef.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block shrink-0 overflow-hidden rounded-md border bg-muted"
      style={{ height: size, width: size }}
      title={driveRef.url}
    >
      {driveRef.fileId ? (
        <DriveImage
          fileId={driveRef.fileId}
          alt="Reference"
          sizes={`${size}px`}
          className="object-cover transition-transform group-hover:scale-105"
          fallback={OPEN_IN_DRIVE}
        />
      ) : (
        OPEN_IN_DRIVE
      )}
      {onRemove && (
        <button
          type="button"
          // preventDefault so the click doesn't also follow the thumbnail's own link-out href.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="absolute right-0.5 top-0.5 z-10 hidden h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 group-hover:flex"
          aria-label="Remove reference"
          title="Remove"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </a>
  );
}
