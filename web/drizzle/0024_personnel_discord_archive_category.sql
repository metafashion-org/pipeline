-- Made re-runnable (IF NOT EXISTS / guarded constraint adds).
--
-- The live database was built with `drizzle-kit push`, which applies schema diffs directly and
-- records nothing in drizzle.__drizzle_migrations. So these objects already exist there while the
-- migrator has no idea they were applied, and a `pnpm db:migrate` against that database would
-- fail on the first CREATE TABLE. Every statement below is now a no-op against a database that
-- already has it, so the same file builds a fresh database from scratch AND runs harmlessly
-- against the live one.

-- Lets an Inactive/Blacklisted personnel record remember which Discord
-- category their artist channel lived in before it got archived, so
-- reactivating them (status back to Active) restores it there instead of
-- guessing or leaving it stranded in "📦 Archive".
ALTER TABLE "personnel" ADD COLUMN IF NOT EXISTS "discord_prior_category_id" text;
