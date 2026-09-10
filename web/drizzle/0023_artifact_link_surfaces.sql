-- Made re-runnable (IF NOT EXISTS / guarded constraint adds).
--
-- The live database was built with `drizzle-kit push`, which applies schema diffs directly and
-- records nothing in drizzle.__drizzle_migrations. So these objects already exist there while the
-- migrator has no idea they were applied, and a `pnpm db:migrate` against that database would
-- fail on the first CREATE TABLE. Every statement below is now a no-op against a database that
-- already has it, so the same file builds a fresh database from scratch AND runs harmlessly
-- against the live one.

CREATE TABLE IF NOT EXISTS "style_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL UNIQUE,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifact_style_system_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"style_system_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_style_system_links_artifact_id_style_system_id_unique" UNIQUE("artifact_id","style_system_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifact_campaign_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"campaign_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_campaign_links_artifact_id_campaign_name_unique" UNIQUE("artifact_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifact_assignment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_assignment_links_artifact_id_assignment_id_unique" UNIQUE("artifact_id","assignment_id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "artifact_style_system_links" ADD CONSTRAINT "artifact_style_system_links_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;
-- A unique constraint raises duplicate_table (42P07) when its backing index already exists, which is what a push-maintained database has, so both codes have to be caught for this to be a no-op there.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "artifact_style_system_links" ADD CONSTRAINT "artifact_style_system_links_style_system_id_style_systems_id_fk" FOREIGN KEY ("style_system_id") REFERENCES "public"."style_systems"("id") ON DELETE no action ON UPDATE no action;
-- A unique constraint raises duplicate_table (42P07) when its backing index already exists, which is what a push-maintained database has, so both codes have to be caught for this to be a no-op there.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "artifact_campaign_links" ADD CONSTRAINT "artifact_campaign_links_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;
-- A unique constraint raises duplicate_table (42P07) when its backing index already exists, which is what a push-maintained database has, so both codes have to be caught for this to be a no-op there.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "artifact_assignment_links" ADD CONSTRAINT "artifact_assignment_links_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;
-- A unique constraint raises duplicate_table (42P07) when its backing index already exists, which is what a push-maintained database has, so both codes have to be caught for this to be a no-op there.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "artifact_assignment_links" ADD CONSTRAINT "artifact_assignment_links_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;
-- A unique constraint raises duplicate_table (42P07) when its backing index already exists, which is what a push-maintained database has, so both codes have to be caught for this to be a no-op there.
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
