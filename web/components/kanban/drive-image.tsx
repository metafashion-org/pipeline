"use client";

import { useState } from "react";
import Image from "next/image";
import { driveThumbnailUrl } from "@/lib/assets/drive-links";

/**
 * Renders a Google Drive file as an image, falling back to `fallback` if it cannot be loaded.
 * The pipeline's reference files are link-shared, so Drive's thumbnail endpoint serves them with no credentials involved. It redirects to lh3.googleusercontent.com, and both hosts are allowed in next.config.ts so the optimizer can fetch and resize them rather than shipping the originals, some of which are several hundred kilobytes.
 *
 * Input: the Drive file id, alt text, the sizes hint for the responsive srcset, and what to render instead when the image fails.
 * Output: a fill-positioned next/image, or the fallback once loading has failed. The parent element must be positioned.
 */
export function DriveImage({
  fileId,
  alt,
  className,
  sizes = "160px",
  fallback = null,
}: {
  fileId: string;
  alt: string;
  className?: string;
  sizes?: string;
  fallback?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return <>{fallback}</>;

  return (
    <Image
      src={driveThumbnailUrl(fileId)}
      alt={alt}
      fill
      sizes={sizes}
      className={className}
      unoptimized={false}
      onError={() => setFailed(true)}
    />
  );
}
