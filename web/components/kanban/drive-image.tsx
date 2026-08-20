"use client";

import { useState } from "react";
import { driveThumbnailUrl } from "@/lib/assets/drive-links";

/**
 * Renders a Google Drive file as an image, falling back to `fallback` if it can't be loaded.
 * The pipeline's reference files are link-shared, so Drive's thumbnail endpoint serves them directly with no credentials involved.
 *
 * Input: the Drive file id, alt text, and what to render instead when the image fails.
 * Output: an <img>, or the fallback once loading has failed.
 */
export function DriveImage({
  fileId,
  alt,
  className,
  fallback = null,
}: {
  fileId: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return <>{fallback}</>;

  return (
    // Plain <img>, not next/image: the source is a Google endpoint that redirects to a signed CDN URL, so there is no stable remote pattern to whitelist and nothing for the optimizer to usefully cache.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={driveThumbnailUrl(fileId)}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
