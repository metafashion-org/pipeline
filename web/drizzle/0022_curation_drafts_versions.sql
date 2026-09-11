-- Made re-runnable (IF NOT EXISTS / guarded constraint adds).
--
-- The live database was built with `drizzle-kit push`, which applies schema diffs directly and
-- records nothing in drizzle.__drizzle_migrations. So these objects already exist there while the
-- migrator has no idea they were applied, and a `pnpm db:migrate` against that database would
-- fail on the first CREATE TABLE. Every statement below is now a no-op against a database that
-- already has it, so the same file builds a fresh database from scratch AND runs harmlessly
-- against the live one.

ALTER TABLE "curation_item_ideas" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "curation_idea_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"idea_title" text NOT NULL,
	"category" text,
	"trend_reasoning" text,
	"source_links" text[] DEFAULT '{}',
	"moodboard_urls" text[] DEFAULT '{}',
	"field_values" jsonb DEFAULT '{}'::jsonb,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "curation_idea_versions" ADD CONSTRAINT "curation_idea_versions_idea_id_curation_item_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."curation_item_ideas"("id") ON DELETE cascade ON UPDATE no action;
-- A unique constraint raises duplicate_table (42P07) when its backing index already exists, which is what a push-maintained database has, so both codes have to be caught for this to be a no-op there.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
