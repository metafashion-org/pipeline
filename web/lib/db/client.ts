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

// prepare: false because production connects through Supabase's pooler (Supavisor) in
// transaction mode, which hands each statement to whichever server connection is free. postgres.js
// otherwise prepares a query on one connection and reuses it by name, so the next statement can
// land on a connection without it: Postgres logged "prepared statement ... does not exist" every
// few seconds, and writes inside a transaction were answered 200 but never kept.
const conn = globalForDb.conn ?? postgres(connectionString, { max: 10, password, prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
