-- Made re-runnable (IF NOT EXISTS / guarded constraint adds).
--
-- The live database was built with `drizzle-kit push`, which applies schema diffs directly and
-- records nothing in drizzle.__drizzle_migrations. So these objects already exist there while the
-- migrator has no idea they were applied, and a `pnpm db:migrate` against that database would
-- fail on the first CREATE TABLE. Every statement below is now a no-op against a database that
-- already has it, so the same file builds a fresh database from scratch AND runs harmlessly
-- against the live one.

ALTER TABLE "curation_field_config" ADD COLUMN IF NOT EXISTS "field_type" text DEFAULT 'text' NOT NULL;
--> statement-breakpoint
ALTER TABLE "curation_field_config" ADD COLUMN IF NOT EXISTS "options" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "curation_field_config" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "curation_item_ideas" ADD COLUMN IF NOT EXISTS "field_values" jsonb DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "curation_item_ideas" ADD COLUMN IF NOT EXISTS "asset_id" uuid REFERENCES "assets"("id");
