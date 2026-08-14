import path from "path";
import { E2E_PERSONNEL } from "@/lib/db/seed-e2e-fixtures";

// Auth-file path constants and the role/email list consumed by global-setup.ts and by specs that
// need a logged-in session (test.use({ storageState: ADMIN_AUTH_FILE })).
export const AUTH_DIR = path.join(__dirname, ".auth");

export const ADMIN_AUTH_FILE = path.join(AUTH_DIR, "admin.json");
export const ARTIST_AUTH_FILE = path.join(AUTH_DIR, "artist.json");
export const PUBLISHER_AUTH_FILE = path.join(AUTH_DIR, "publisher.json");

export const E2E_ACCOUNTS = E2E_PERSONNEL.map((p) => ({
  role: p.roles[0],
  email: p.email,
  authFile: path.join(AUTH_DIR, `${p.roles[0]}.json`),
}));
