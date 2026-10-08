"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DriveImage } from "./drive-image";
import { driveThumbnailUrl, type DriveRef } from "@/lib/assets/drive-links";

// Width asked of Drive's thumbnail endpoint for the full-size view. Drive serves the original when
// it is smaller, so this only caps how large a big file gets.
const VIEWER_IMAGE_WIDTH_PX = 2000;

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
 * One Drive reference as a thumbnail. Clicking an image opens it full size inside the app, with an
 * "Open in Drive" button; a link with no image behind it (a folder, a non-Drive URL) opens in Drive
 * directly. Shared by the asset drawer's read-only gallery, the create/edit form's editable one and
 * the Registry: `onRemove` adds the form's hover-revealed remove button.
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
  const [viewerOpen, setViewerOpen] = useState(false);
  // Set when Drive's thumbnail fails, so the click falls back to opening Drive instead of an empty viewer.
  const [imageFailed, setImageFailed] = useState(false);
  const fileId = driveRef.fileId;
  const viewable = !!fileId && !imageFailed;
  const boxClass = "group relative block shrink-0 overflow-hidden rounded-md border bg-muted";

  const removeButton = onRemove && (
    <button
      type="button"
      // preventDefault so the click doesn't also open the thumbnail.
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
  );

  if (!viewable) {
    return (
      <a href={driveRef.url} target="_blank" rel="noopener noreferrer" className={boxClass} style={{ height: size, width: size }} title={driveRef.url}>
        {OPEN_IN_DRIVE}
        {removeButton}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setViewerOpen(true)}
        className={`${boxClass} cursor-zoom-in`}
        style={{ height: size, width: size }}
        title="View image"
        aria-label="View image"
      >
        <DriveImage
          fileId={fileId}
          alt="Reference"
          sizes={`${size}px`}
          className="object-cover transition-transform group-hover:scale-105"
          onFailed={() => setImageFailed(true)}
        />
        {removeButton}
      </button>
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="flex max-h-[95vh] flex-col gap-3 p-3 sm:max-w-5xl">
          <DialogTitle className="sr-only">Reference image</DialogTitle>
          <div className="relative h-[80vh] w-full overflow-hidden rounded-md bg-muted">
            <Image src={driveThumbnailUrl(fileId, VIEWER_IMAGE_WIDTH_PX)} alt="Reference" fill sizes="90vw" className="object-contain" />
          </div>
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <a href={driveRef.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Drive
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
