-- Naming evidence for Today's Picks: the report lines, workbook rows, image correspondences and
-- live Roblox metadata a final name rests on, each with its source, exact location, quoted text or
-- what the image shows, the name words it supports, a confidence, its limits and any conflict.
--
-- Kept apart from artifact_sku_links, which records an asset's historical design origin. A naming
-- record says "this source supports these words"; it never claims or changes where a design came
-- from. Rows are never deleted: a wrong one is retired with a reason. row_hash is unique so
-- re-reading the sheet's Evidence tab stores nothing twice.
--
-- Additive only. One DO block per constraint, like 0053-0054.

CREATE TABLE IF NOT EXISTS "name_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  -- 'report_line' | 'workbook_row' | 'image_correspondence' | 'live_metadata'
  "kind" text NOT NULL,
  "source_ref" text NOT NULL,
  "location" text NOT NULL,
  "quote" text NOT NULL,
  "supports" text[] DEFAULT '{}' NOT NULL,
  -- 'high' | 'medium' | 'low'
  "confidence" text NOT NULL,
  "limits" text,
  "conflict" text,
  "entered_by" text,
  "row_hash" text NOT NULL,
  "retired_at" timestamp with time zone,
  "retired_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'name_evidence_asset_id_fk') THEN
    ALTER TABLE "name_evidence" ADD CONSTRAINT "name_evidence_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "name_evidence_row_hash_idx" ON "name_evidence" USING btree ("row_hash");
CREATE INDEX IF NOT EXISTS "name_evidence_asset_idx" ON "name_evidence" USING btree ("asset_id");

-- Same as the other Today's Picks tables: the app reaches Postgres directly, never through Supabase's REST API.
ALTER TABLE "name_evidence" ENABLE ROW LEVEL SECURITY;
