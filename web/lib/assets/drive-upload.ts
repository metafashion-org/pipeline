/**
 * Uploads a reference image directly into the team's Shared Drive, so adding a reference no
 * longer requires already having the file on Drive and pasting a link by hand.
 *
 * Ported from catalog-intel's server/lib/sheets.cjs (same service account, same Shared Drive,
 * same auth/retry/sharing pattern — proven in production there for Focus Group folders) rather
 * than reinvented. That file already solved the exact problem this needs solved too: a bare API
 * service account with no Google Workspace org behind it has no Drive storage quota of its own,
 * so files must be created inside a Shared Drive (which has its own org-owned storage) or every
 * upload 403s. See that file's header comment for the full story if this needs debugging.
 *
 * The resulting link is stored in assets.reference_images exactly like a pasted link always has
 * been — lib/assets/drive-links.ts already knows how to thumbnail a drive.google.com file URL,
 * so nothing downstream of the upload needed to change.
 */

import { JWT } from "google-auth-library";

const SHARE_DOMAIN = "metafashion.in";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

function sharedDriveId(): string | null {
  return process.env.GOOGLE_SHARED_DRIVE_ID || null;
}

export function isConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !!sharedDriveId();
}

let cachedAuth: JWT | null = null;

function getAuth(): JWT {
  if (cachedAuth) return cachedAuth;
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string);
  cachedAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    // drive.file: this service account can only ever touch files/folders it creates itself —
    // never a browse-the-whole-Drive scope. Same scope catalog-intel's proven integration uses.
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  return cachedAuth;
}

// Retry on Google's own documented-transient statuses, same as sheets.cjs's authedFetch. Not
// applied to the actual upload call further down (a large binary body is awkward to safely
// replay); this covers the folder find/create/share calls, which are small and idempotent.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DriveApiError extends Error {
  status?: number;
}

async function authedFetch(url: string, init: RequestInit = {}): Promise<any> {
  const auth = getAuth();
  await auth.authorize();
  let lastErr: DriveApiError = new Error("Drive request failed");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const token = (await auth.getAccessToken()).token;
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    if (res.ok) return res.json().catch(() => ({}));
    const body = await res.json().catch(() => ({}));
    const err: DriveApiError = new Error(body?.error?.message || `${res.status} ${res.statusText}`);
    err.status = res.status;
    lastErr = err;
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) throw err;
    const backoffMs = Math.min(15000, 1000 * 2 ** (attempt - 1)) + Math.random() * 500;
    await sleep(backoffMs);
  }
  throw lastErr;
}

// Shares a just-created file/folder with the whole metafashion.in domain. Mirrors sheets.cjs's
// shareItem(): Shared Drive membership alone did not cover the whole domain in a real past
// incident there (colleagues with no Shared Drive membership had zero access to a folder even
// though it lived inside one), so this domain grant is layered on top rather than assumed
// redundant. Best-effort — a failed share shouldn't fail the upload the file itself succeeded at.
async function shareWithDomain(fileId: string): Promise<void> {
  try {
    await authedFetch(`${DRIVE_API}/files/${fileId}/permissions?supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", domain: SHARE_DOMAIN, role: "writer" }),
    });
  } catch {
    // Best-effort, same as the proven original.
  }
}

async function findFolder(name: string, driveId: string): Promise<string | null> {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `name='${escaped}' and '${driveId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const result = await authedFetch(
    `${DRIVE_API}/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${encodeURIComponent(driveId)}&fields=files(id)`
  );
  return result.files?.[0]?.id || null;
}

async function createFolder(name: string, driveId: string): Promise<string> {
  const folder = await authedFetch(`${DRIVE_API}/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [driveId] }),
  });
  await shareWithDomain(folder.id);
  return folder.id;
}

// Finds (or creates) the one Drive folder holding an asset's reference files. Naming mirrors
// catalog-intel's "Catalog Intel — <Focus Group Name>" convention.
async function getOrCreateAssetFolder(sku: string): Promise<string> {
  const driveId = sharedDriveId();
  if (!driveId) throw new Error("GOOGLE_SHARED_DRIVE_ID not set");
  const name = `Meta Fashion Pipeline — ${sku}`.slice(0, 200);
  const existing = await findFolder(name, driveId);
  if (existing) return existing;
  return createFolder(name, driveId);
}

export interface UploadedReference {
  url: string;
  fileId: string;
}

/**
 * Uploads one file into the asset's Drive folder (created on first upload) and returns a
 * link usable directly as a pasted reference link — lib/assets/drive-links.ts's
 * extractDriveFileId() recognizes the /file/d/<id>/view shape returned here.
 */
export async function uploadReferenceFile(
  sku: string,
  fileName: string,
  mimeType: string,
  bytes: Buffer
): Promise<UploadedReference> {
  if (!isConfigured()) {
    throw new Error("Drive upload isn't configured (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHARED_DRIVE_ID missing).");
  }
  const folderId = await getOrCreateAssetFolder(sku);

  const boundary = `metafashion-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const auth = getAuth();
  await auth.authorize();
  const token = (await auth.getAccessToken()).token;
  const res = await fetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `Drive upload failed: ${res.status} ${res.statusText}`);
  }
  const created = await res.json();
  await shareWithDomain(created.id);

  return {
    url: `https://drive.google.com/file/d/${created.id}/view`,
    fileId: created.id,
  };
}
