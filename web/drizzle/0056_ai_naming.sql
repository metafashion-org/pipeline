-- AI naming before upload: Claude suggests names for items at Ready for upload, grouped by shared
-- artifacts, and Arjun approves one. The approved name is what the uploader puts on Roblox and
-- what Today's Picks starts from.
--
-- assets.approved_name / _at / _by: the name Arjun approved for the Roblox listing. Null until then.
-- name_proposals: one row per asset per distinct set of naming inputs; input_hash is unique per
-- asset so the same inputs are never sent to Claude (and paid for) twice.
--
-- Additive only. One DO block per constraint, like 0053-0055.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "approved_name" text;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "approved_name_at" timestamp with time zone;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "approved_name_by" uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_approved_name_by_personnel_id_fk') THEN
    ALTER TABLE "assets" ADD CONSTRAINT "assets_approved_name_by_personnel_id_fk" FOREIGN KEY ("approved_name_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "name_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  -- One naming run, which may cover several groups of assets.
  "batch_id" uuid NOT NULL,
  -- The artifacts the asset was grouped by, e.g. "ANA007,MBD001", or "none".
  "group_key" text NOT NULL,
  "model" text NOT NULL,
  "input_hash" text NOT NULL,
  -- [{ name, why, words: [{ word, source }] }]
  "candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "image_notes" text,
  -- 'pending' | 'approved' | 'superseded' | 'failed'
  "status" text DEFAULT 'pending' NOT NULL,
  "chosen_name" text,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'name_proposals_asset_id_fk') THEN
    ALTER TABLE "name_proposals" ADD CONSTRAINT "name_proposals_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'name_proposals_decided_by_fk') THEN
    ALTER TABLE "name_proposals" ADD CONSTRAINT "name_proposals_decided_by_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "name_proposals_asset_input_idx" ON "name_proposals" USING btree ("asset_id", "input_hash");
CREATE INDEX IF NOT EXISTS "name_proposals_status_idx" ON "name_proposals" USING btree ("status");

-- Same as the other new tables: the app reaches Postgres directly, never through Supabase's REST API.
ALTER TABLE "name_proposals" ENABLE ROW LEVEL SECURITY;
