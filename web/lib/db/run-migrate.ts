import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const connectionString = process.env.DATABASE_URL || "";
  // See lib/db/client.ts: the `postgres` library doesn't percent-decode the
  // password component, so it must be decoded and passed as an explicit override.
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
  const sql = postgres(connectionString, { max: 1, password });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
