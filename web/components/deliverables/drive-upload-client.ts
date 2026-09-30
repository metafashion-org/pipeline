/**
 * Sends one file straight to Drive through the upload session this app opened for it (see
 * startResumableUpload in lib/assets/drive-upload.ts), reporting progress. XMLHttpRequest rather
 * than fetch: fetch can't report upload progress.
 *
 * Input: the session's upload URL, the file, and a callback for the fraction sent (0 to 1).
 * Output: resolves once Drive has the whole file; rejects on a failed or interrupted upload.
 */
export function uploadToDrive(uploadUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Drive answered ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("The upload was interrupted"));
    xhr.send(file);
  });
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

export function formatFileSize(bytes: number): string {
  return bytes >= BYTES_PER_MB ? `${(bytes / BYTES_PER_MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;
}
