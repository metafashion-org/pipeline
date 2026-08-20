import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dotenv from "dotenv";
import * as schema from "./schema";

// Next.js loads .env.local automatically at runtime, so this is a no-op there
// (dotenv never overrides an already-set var) - but standalone scripts run via
// plain `tsx` (migrations, __tests__/*.test.ts) don't get that for free, and
// silently fall back to empty-string env vars without this.
dotenv.config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL || "";

// The `postgres` library doesn't percent-decode the password component of the
// connection string, so a password containing a reserved URL character (e.g. "@")
// sent literally instead of decoded, and auth fails even with the right password.
// Decoding it explicitly here and passing it as an override fixes that.
/**
 * Reads and percent-decodes the password out of a Postgres connection string.
 * Input: the connection string, possibly empty or malformed. Output: the decoded password, or undefined when there is none to read.
 * A malformed DATABASE_URL would otherwise throw a bare URL parse error at module load, which surfaces as an unexplained crash on the first request rather than a configuration message.
 */
function parseConnectionPassword(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(new URL(value).password) || undefined;
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string URL");
  }
}

const password = parseConnectionPassword(connectionString);

// Cache database connection across hot reloads in development
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const conn = globalForDb.conn ?? postgres(connectionString, { max: 10, password });
if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
