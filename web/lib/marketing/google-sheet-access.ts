// Google calls for the private Today's Picks sheet. The sheet is Arjun's own file in his My Drive,
// shared with the Kanban's service account, so it needs scopes the rest of the app doesn't:
// - spreadsheets: open and write a sheet someone else made and shared with the service account
//   (lib/assets/drive-upload.ts's drive.file scope only reaches files the account made itself).
// - drive.metadata.readonly: read the file's owner, shared drive and permissions, so the Kanban can
//   refuse to write when anyone besides Arjun and the service account can open it. It can't read
//   or change any file's contents.
// A separate token keeps those scopes away from the Drive uploads.

import { JWT } from "google-auth-library";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.metadata.readonly"];
// Google's documented transient statuses; the same set drive-upload.ts retries.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const MAX_BACKOFF_MS = 15_000;

export interface FileAccess {
  ownerEmails: string[];
  driveId: string | null;
  trashed: boolean;
  permissions: { type: string; role: string; emailAddress: string | null; domain: string | null }[];
}

export interface SheetTab {
  sheetId: number;
  title: string;
  rowCount: number;
}

export type SheetRequest = Record<string, unknown>;

/** The calls the Today's Picks sheet makes, so tests can stand in for Google. */
export interface SheetClient {
  serviceAccountEmail: () => string;
  getFileAccess: (fileId: string) => Promise<FileAccess>;
  getTabs: (sheetId: string) => Promise<SheetTab[]>;
  /** One spreadsheets.batchUpdate: Google applies all of its requests or none of them. */
  batchUpdate: (sheetId: string, requests: SheetRequest[]) => Promise<void>;
  /** values.append: adds rows after the last row with data, without reading it first. */
  appendRows: (sheetId: string, range: string, rows: string[][]) => Promise<void>;
  /** values.get: the cells of an A1 range as rows of strings. */
  readRows: (sheetId: string, range: string) => Promise<string[][]>;
}

let cachedAuth: JWT | null = null;
let cachedEmail: string | null = null;

function getAuth(): JWT {
  if (cachedAuth) return cachedAuth;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON isn't set");
  const creds = JSON.parse(raw);
  cachedEmail = creds.client_email;
  cachedAuth = new JWT({ email: creds.client_email, key: creds.private_key, scopes: SCOPES });
  return cachedAuth;
}

async function googleFetch(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const auth = getAuth();
  let lastErr = new Error("Google request failed");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const token = (await auth.getAccessToken()).token;
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
    if (res.ok) return res.json().catch(() => ({}));
    const body = await res.json().catch(() => ({}));
    lastErr = new Error(body?.error?.message || `Google answered ${res.status}`);
    if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) throw lastErr;
    await new Promise((resolve) => setTimeout(resolve, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1))));
  }
  throw lastErr;
}

export const GOOGLE_SHEET_CLIENT: SheetClient = {
  serviceAccountEmail: () => {
    getAuth();
    return cachedEmail ?? "";
  },
  async getFileAccess(fileId) {
    const id = encodeURIComponent(fileId);
    const file = await googleFetch(`${DRIVE_API}/${id}?supportsAllDrives=true&fields=driveId,trashed,owners(emailAddress)`);
    const perms = await googleFetch(`${DRIVE_API}/${id}/permissions?supportsAllDrives=true&fields=permissions(type,role,emailAddress,domain)`);
    return {
      ownerEmails: ((file.owners as { emailAddress?: string }[] | undefined) ?? []).map((o) => (o.emailAddress ?? "").toLowerCase()),
      driveId: (file.driveId as string | undefined) ?? null,
      trashed: !!file.trashed,
      permissions: ((perms.permissions as FileAccess["permissions"] | undefined) ?? []).map((p) => ({
        type: p.type,
        role: p.role,
        emailAddress: p.emailAddress?.toLowerCase() ?? null,
        domain: p.domain ?? null,
      })),
    };
  },
  async getTabs(sheetId) {
    const data = await googleFetch(`${SHEETS_API}/${encodeURIComponent(sheetId)}?fields=sheets.properties(sheetId,title,gridProperties.rowCount)`);
    return ((data.sheets as { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number } } }[] | undefined) ?? []).map(({ properties }) => ({
      sheetId: properties.sheetId,
      title: properties.title,
      rowCount: properties.gridProperties?.rowCount ?? 0,
    }));
  },
  async batchUpdate(sheetId, requests) {
    await googleFetch(`${SHEETS_API}/${encodeURIComponent(sheetId)}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
  },
  async readRows(sheetId, range) {
    const data = await googleFetch(`${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`);
    return ((data.values as string[][] | undefined) ?? []).map((row) => row.map((cell) => String(cell ?? "")));
  },
  async appendRows(sheetId, range, rows) {
    await googleFetch(`${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ values: rows }),
    });
  },
};
