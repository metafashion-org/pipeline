import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client";

async function runAllMigrations() {
  console.log("Running all pending Drizzle SQL migrations against live Supabase database...");
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✓ All migrations successfully applied to live Supabase DB!");
  } catch (err: any) {
    console.error("Migration error:", err.message);
  }
}

runAllMigrations().then(() => process.exit(0));
