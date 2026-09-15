import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dotenv from "dotenv";
import * as schema from "./schema";
import { parseConnectionPassword } from "./connection";

// Next.js loads .env.local automatically at runtime, so this is a no-op there
// (dotenv never overrides an already-set var) - but standalone scripts run via
// plain `tsx` (migrations, __tests__/*.test.ts) don't get that for free, and
// silently fall back to empty-string env vars without this.
dotenv.config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL || "";

const password = parseConnectionPassword(connectionString);

// Cache database connection across hot reloads in development
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const conn = globalForDb.conn ?? postgres(connectionString, { max: 10, password });
if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
