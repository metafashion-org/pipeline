-- Made re-runnable (IF NOT EXISTS / guarded constraint adds).
--
-- The live database was built with `drizzle-kit push`, which applies schema diffs directly and
-- records nothing in drizzle.__drizzle_migrations. So these objects already exist there while the
-- migrator has no idea they were applied, and a `pnpm db:migrate` against that database would
-- fail on the first CREATE TABLE. Every statement below is now a no-op against a database that
-- already has it, so the same file builds a fresh database from scratch AND runs harmlessly
-- against the live one.

ALTER TABLE "marketing_updates" ADD COLUMN IF NOT EXISTS "post_type" text;
--> statement-breakpoint
ALTER TABLE "marketing_updates" ADD COLUMN IF NOT EXISTS "high_performing" boolean DEFAULT false NOT NULL;
