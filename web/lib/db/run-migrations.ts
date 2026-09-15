import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client";
import { errorMessage } from "../errors";

// Applies every pending migration in ./drizzle to DATABASE_URL, which falls back to web/.env.local. Prefer `pnpm db:migrate` (run-migrate.ts), which opens its own single connection.
async function runAllMigrations() {
  console.log("Running all pending Drizzle SQL migrations against DATABASE_URL...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ All migrations applied.");
}

// Exits 1 on failure so a calling script or CI step stops instead of reporting success.
runAllMigrations()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("Migration error:", errorMessage(err, String(err)));
    process.exit(1);
  });
