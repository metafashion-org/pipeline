import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const connectionString = process.env.DATABASE_URL || "";
  // See lib/db/client.ts: the `postgres` library doesn't percent-decode the
  // password component, so it must be decoded and passed as an explicit override.
  const password = connectionString ? decodeURIComponent(new URL(connectionString).password) : undefined;
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
