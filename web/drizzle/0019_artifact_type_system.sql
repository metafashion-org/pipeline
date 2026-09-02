-- Made re-runnable (IF NOT EXISTS / guarded constraint adds).
--
-- The live database was built with `drizzle-kit push`, which applies schema diffs directly and
-- records nothing in drizzle.__drizzle_migrations. So these objects already exist there while the
-- migrator has no idea they were applied, and a `pnpm db:migrate` against that database would
-- fail on the first CREATE TABLE. Every statement below is now a no-op against a database that
-- already has it, so the same file builds a fresh database from scratch AND runs harmlessly
-- against the live one.

CREATE TABLE IF NOT EXISTS "artifact_type_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prefix" text NOT NULL UNIQUE,
	"label" text NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" DROP COLUMN IF EXISTS "artifact_type";
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ALTER COLUMN "file_url" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "artifact_id" text NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_artifacts" ADD CONSTRAINT "knowledge_artifacts_artifact_id_unique" UNIQUE ("artifact_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "artifact_type_id" uuid NOT NULL REFERENCES "artifact_type_config"("id");
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "added_by" uuid REFERENCES "personnel"("id");
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "usage_notes" text;
