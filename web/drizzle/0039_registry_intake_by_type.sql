-- The Registry's New Artifact form asks only for the fields that fit the chosen type
-- (lib/knowledge/artifact-forms.ts). Adds:
--   - knowledge_artifacts.details: the per-type fields that have no column of their own, e.g. a
--     prompt's chat link and the files that went into it, an insight's date seen and its images
--   - knowledge_artifacts.trend_artifact_id: the Trend Brief a moodboard or recolor kit came from
--   - knowledge_artifacts.archived_at / archived_by: takes an artifact out of the Registry without
--     deleting it; its ID stays claimed
--   - artifact_type_config.is_active: takes a type off the form; artifacts of it keep their IDs
-- and retires three types from the form: Marketing Insight (merged into Insight), Reference
-- (nobody uses it), and Test Data.
--
-- Apply this before deploying the code that reads these columns. The code before it selects only
-- the columns it knows, so the additions change nothing for it.
--
-- Written idempotently, like 0019-0038, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "details" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "trend_artifact_id" uuid;
ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "knowledge_artifacts" ADD COLUMN IF NOT EXISTS "archived_by" uuid;
ALTER TABLE "artifact_type_config" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_artifacts_trend_artifact_id_fk') THEN
    ALTER TABLE "knowledge_artifacts"
      ADD CONSTRAINT "knowledge_artifacts_trend_artifact_id_fk"
      FOREIGN KEY ("trend_artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_artifacts_archived_by_personnel_id_fk') THEN
    ALTER TABLE "knowledge_artifacts"
      ADD CONSTRAINT "knowledge_artifacts_archived_by_personnel_id_fk"
      FOREIGN KEY ("archived_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- Marketing Insight is now part of Insight, Reference had no artifacts and no clear use, and Test
-- Data held only placeholder rows. Their artifacts keep their IDs.
UPDATE "artifact_type_config" SET "is_active" = false WHERE "prefix" IN ('MKT', 'REF', 'TEST') AND "is_active";
