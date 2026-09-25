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

// Freelance artists are never on the metafashion.in domain, and driveThumbnailUrl() (see
// lib/assets/drive-links.ts) renders reference images by hitting Drive's public thumbnail
// endpoint with no credentials at all — both need a file readable by anyone with the link, which
// the domain-only grant above does not provide. Best-effort for the same reason as that grant.
async function shareWithAnyoneReader(fileId: string): Promise<void> {
  try {
    await authedFetch(`${DRIVE_API}/files/${fileId}/permissions?supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "anyone", role: "reader" }),
    });
  } catch {
    // Best-effort, same as the domain grant above.
  }
}

// Drive's query language quotes names in single quotes.
function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// `parentId` is the Shared Drive's own id for a top-level folder, or a folder id for a nested one.
async function findFolder(name: string, parentId: string, driveId: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${escapeDriveQuery(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const result = await authedFetch(
    `${DRIVE_API}/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${encodeURIComponent(driveId)}&fields=files(id)`
  );
  return result.files?.[0]?.id || null;
}

async function createFolder(name: string, parentId: string): Promise<string> {
  const folder = await authedFetch(`${DRIVE_API}/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  await shareWithDomain(folder.id);
  return folder.id;
}

function requireSharedDriveId(): string {
  const driveId = sharedDriveId();
  if (!driveId) throw new Error("GOOGLE_SHARED_DRIVE_ID not set");
  return driveId;
}

// Finds (or creates) a named folder inside `parentId`, which defaults to the Shared Drive's root.
async function getOrCreateFolderIn(name: string, parentId?: string): Promise<string> {
  const driveId = requireSharedDriveId();
  const parent = parentId ?? driveId;
  const truncated = name.slice(0, 200);
  const existing = await findFolder(truncated, parent, driveId);
  if (existing) return existing;
  return createFolder(truncated, parent);
}

// Finds (or creates) a named Drive folder directly under the shared drive root. Naming mirrors
// catalog-intel's "Catalog Intel — <Focus Group Name>" convention — every folder this app creates
// is "Meta Fashion Pipeline — <what it's for>", just with a different suffix per caller.
async function getOrCreateFolder(name: string): Promise<string> {
  return getOrCreateFolderIn(name);
}

async function getOrCreateAssetFolder(sku: string): Promise<string> {
  return getOrCreateFolder(`Meta Fashion Pipeline — ${sku}`);
}

// Payment summaries are grouped per artist rather than per asset — one payout can cover several
// SKUs at once, so there's no single asset folder a receipt for the whole batch belongs in.
async function getOrCreatePaymentFolder(artistName: string): Promise<string> {
  return getOrCreateFolder(`Meta Fashion Pipeline — Payments — ${artistName}`);
}

export interface UploadedReference {
  url: string;
  fileId: string;
}

/** The actual multipart upload, shared by every caller below — only the destination folder differs. */
async function uploadFileToFolder(
  folderId: string,
  fileName: string,
  mimeType: string,
  bytes: Buffer
): Promise<UploadedReference> {
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
  await shareWithAnyoneReader(created.id);

  return {
    url: `https://drive.google.com/file/d/${created.id}/view`,
    fileId: created.id,
  };
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
  return uploadFileToFolder(folderId, fileName, mimeType, bytes);
}

/**
 * Uploads a payment summary (the bank's payout confirmation) into that artist's payments folder.
 * Same underlying upload as uploadReferenceFile — only which folder it lands in differs, because
 * a payout batch belongs to an artist, not to any one of the SKUs it covers.
 */
export async function uploadPaymentSummaryFile(
  artistName: string,
  fileName: string,
  mimeType: string,
  bytes: Buffer
): Promise<UploadedReference> {
  if (!isConfigured()) {
    throw new Error("Drive upload isn't configured (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHARED_DRIVE_ID missing).");
  }
  const folderId = await getOrCreatePaymentFolder(artistName);
  return uploadFileToFolder(folderId, fileName, mimeType, bytes);
}

// ---------------------------------------------------------------------------------------------
// Final files
//
// Final 3D files are often hundreds of megabytes, far past what a request to this app can carry
// (Vercel caps a function's request body at 4.5 MB). So the browser uploads them straight to
// Drive: this app only opens a resumable upload session for each file, in the right folder, and
// hands the browser its upload URL. Once the browser is done, the app lists the folder to record
// what arrived.
// ---------------------------------------------------------------------------------------------

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * The folder one final-files submission goes in: "Meta Fashion Pipeline — <SKU>/Final Files/v<N>".
 * Created on first use; the same call returns the same folder afterwards.
 *
 * Input: the asset's SKU and the submission's version number. Output: the v<N> folder's id.
 */
export async function getOrCreateFinalFilesFolder(sku: string, version: number): Promise<string> {
  const assetFolderId = await getOrCreateAssetFolder(sku);
  const finalFilesFolderId = await getOrCreateFolderIn("Final Files", assetFolderId);
  return getOrCreateFolderIn(`v${version}`, finalFilesFolderId);
}

/**
 * Opens a resumable upload session for one file in `folderId`, for the browser to send the bytes to.
 *
 * Input: the folder, the file's name, type and size, and the browser's origin. Output: the session's
 * upload URL. `origin` has to be the page's own origin: Drive only answers the browser's upload
 * with CORS headers for the origin the session was opened for.
 */
export async function startResumableUpload(
  folderId: string,
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  origin: string
): Promise<string> {
  const auth = getAuth();
  await auth.authorize();
  const token = (await auth.getAccessToken()).token;
  const res = await fetch(`${DRIVE_UPLOAD_API}?uploadType=resumable&supportsAllDrives=true&fields=id,name`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(sizeBytes),
      Origin: origin,
    },
    body: JSON.stringify({ name: fileName, parents: [folderId] }),
  });
  const uploadUrl = res.headers.get("location");
  if (!res.ok || !uploadUrl) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Drive refused the upload session (${res.status})`);
  }
  return uploadUrl;
}

export interface DriveFolderFile {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdTime: string;
  url: string;
}

/** Every file in a folder, newest first. Only files this service account created are visible to it (drive.file scope). */
export async function listFilesInFolder(folderId: string): Promise<DriveFolderFile[]> {
  const driveId = requireSharedDriveId();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`);
  const result = await authedFetch(
    `${DRIVE_API}/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${encodeURIComponent(driveId)}&orderBy=createdTime desc&pageSize=1000&fields=files(id,name,mimeType,size,createdTime)`
  );
  return (result.files || []).map((f: { id: string; name: string; mimeType?: string; size?: string; createdTime: string }) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType ?? null,
    sizeBytes: f.size ? Number(f.size) : null,
    createdTime: f.createdTime,
    url: driveFileUrl(f.id),
  }));
}

/** Gives a submitted final file the same access as references: the domain can edit, anyone with the link can view. */
export async function shareFinalFile(fileId: string): Promise<void> {
  await shareWithDomain(fileId);
  await shareWithAnyoneReader(fileId);
}
