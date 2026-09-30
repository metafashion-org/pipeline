-- The "3D Art Submission Form" Google Form moves into the app as the Submit final files page. Adds:
--   - asset_final_submissions: one row per hand-in (asset, version, the artist's comments, who)
--   - asset_deliverables.submission_id: the hand-in a file came with
--   - asset_deliverables.kind: the form slot it was uploaded in (images, model_zip, motion_pack)
-- Files already recorded get a submission row per (asset, version) and are linked to it; their
-- kind stays empty.
--
-- Apply this before deploying the code that reads these columns. The code before it selects only
-- the columns it knows, so the additions change nothing for it.
--
-- Written idempotently, like 0019-0036, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

CREATE TABLE IF NOT EXISTS "asset_final_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "comments" text,
  "submitted_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_final_submissions_asset_id_assets_id_fk') THEN
    ALTER TABLE "asset_final_submissions"
      ADD CONSTRAINT "asset_final_submissions_asset_id_assets_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_final_submissions_submitted_by_personnel_id_fk') THEN
    ALTER TABLE "asset_final_submissions"
      ADD CONSTRAINT "asset_final_submissions_submitted_by_personnel_id_fk"
      FOREIGN KEY ("submitted_by") REFERENCES "public"."personnel"("id") ON DELETE no action ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "asset_final_submissions_asset_version_idx"
  ON "asset_final_submissions" USING btree ("asset_id", "version");

ALTER TABLE "asset_deliverables" ADD COLUMN IF NOT EXISTS "submission_id" uuid;
ALTER TABLE "asset_deliverables" ADD COLUMN IF NOT EXISTS "kind" text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_deliverables_submission_id_asset_final_submissions_id_fk') THEN
    ALTER TABLE "asset_deliverables"
      ADD CONSTRAINT "asset_deliverables_submission_id_asset_final_submissions_id_fk"
      FOREIGN KEY ("submission_id") REFERENCES "public"."asset_final_submissions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "asset_deliverables_submission_idx" ON "asset_deliverables" USING btree ("submission_id");

-- One submission for each version already handed in, dated and credited from its first file.
INSERT INTO "asset_final_submissions" ("asset_id", "version", "submitted_by", "created_at")
SELECT "asset_id", "version", (array_agg("uploaded_by" ORDER BY "created_at"))[1], min("created_at")
FROM "asset_deliverables"
GROUP BY "asset_id", "version"
ON CONFLICT ("asset_id", "version") DO NOTHING;

UPDATE "asset_deliverables" d
SET "submission_id" = s."id"
FROM "asset_final_submissions" s
WHERE d."submission_id" IS NULL AND d."asset_id" = s."asset_id" AND d."version" = s."version";
