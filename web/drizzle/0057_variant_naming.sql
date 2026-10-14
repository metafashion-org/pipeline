-- Per-variant naming: every colour listing gets its own approved name.
--
-- name_proposals.kind: 'base' (one base name per item), 'colourways' (before upload: one name per
-- colourway read from the recolour sheet) or 'listings' (after upload: one name per live Roblox
-- listing read from its thumbnail). Its input hash already differs per kind.
-- assets.approved_colourways: the colourway names Arjun approved before upload, [{ colour, name }];
-- the uploader names each listing from this list.
-- upload_records.approved_name / _at / _by: the approved Roblox name of that one listing. Today's
-- Picks checks a main listing's Roblox name against it.
--
-- Additive only. One DO block per constraint, like 0053-0056.

ALTER TABLE "name_proposals" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'base' NOT NULL;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "approved_colourways" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "upload_records" ADD COLUMN IF NOT EXISTS "approved_name" text;
ALTER TABLE "upload_records" ADD COLUMN IF NOT EXISTS "approved_name_at" timestamp with time zone;
ALTER TABLE "upload_records" ADD COLUMN IF NOT EXISTS "approved_name_by" uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_records_approved_name_by_personnel_id_fk') THEN
    ALTER TABLE "upload_records" ADD CONSTRAINT "upload_records_approved_name_by_personnel_id_fk" FOREIGN KEY ("approved_name_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
