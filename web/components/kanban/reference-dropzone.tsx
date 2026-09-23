"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { useReferenceUpload } from "./use-reference-upload";

/**
 * Wraps a reference-files section (its label, thumbnails and upload button) as a drop target, on
 * top of the existing click-to-browse ReferenceUploadButton — dragging files from the desktop and
 * dropping them anywhere in the wrapped area uploads them the same way clicking Upload does.
 *
 * Owns the one useReferenceUpload() call for the section and hands its state to `children` as a
 * render prop, so ReferenceUploadButton (rendered inside) shares the same "uploading" state and
 * the same upload function as a drop — whichever one someone used, there is only one upload in
 * flight and one set of toasts.
 *
 * drag events fire on every child element a pointer passes over, not just the container, so a
 * naive dragenter/dragleave toggle flickers the highlight on and off while dragging across the
 * label, the thumbnails and the button inside. A nesting counter (entries minus leaves) is what
 * keeps the highlight steady until the pointer actually leaves the whole zone.
 */
export function ReferenceDropzone({
  sku,
  disabled,
  onUploaded,
  children,
}: {
  sku: string;
  disabled?: boolean;
  onUploaded: (urls: string[]) => void;
  children: (state: { uploading: boolean; uploadFiles: (files: File[]) => void }) => ReactNode;
}) {
  const { uploading, uploadFiles } = useReferenceUpload({ sku, onUploaded });
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const dragDepth = useRef(0);

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled) return;
    dragDepth.current += 1;
    setIsDraggedOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggedOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDraggedOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) uploadFiles(files);
  }

  return (
    <div
      // A drop is refused by the browser by default unless dragover is also prevented, not only drop.
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`grid gap-1.5 rounded-md -m-1.5 p-1.5 transition-colors ${
        isDraggedOver ? "bg-primary/5 outline-2 outline-dashed outline-primary outline-offset-2" : ""
      }`}
    >
      {children({ uploading, uploadFiles })}
    </div>
  );
}
