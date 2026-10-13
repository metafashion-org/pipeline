-- Today's Picks preview (Stage 1): which Roblox listing represents each SKU, and a history of what
-- Roblox showed for each listing when someone checked it.
--
-- upload_records.main_at/main_by: Arjun picks one listing per asset as its main listing (the link a
-- nomination would use). At most one per asset, enforced by the partial unique index below.
--
-- roblox_listing_checks: one row per check of one listing, kept next to our own on-sale tick so a
-- later difference between the two is visible with the time it was seen. Append-only.
--
-- Additive only. Written idempotently, like 0019-0052, with one DO block per constraint so an
-- existing constraint never skips the others.

ALTER TABLE "upload_records" ADD COLUMN IF NOT EXISTS "main_at" timestamp with time zone;
ALTER TABLE "upload_records" ADD COLUMN IF NOT EXISTS "main_by" uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_records_main_by_personnel_id_fk') THEN
    ALTER TABLE "upload_records" ADD CONSTRAINT "upload_records_main_by_personnel_id_fk" FOREIGN KEY ("main_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- One main listing per asset.
CREATE UNIQUE INDEX IF NOT EXISTS "upload_records_one_main_per_asset_idx" ON "upload_records" USING btree ("asset_id") WHERE "main_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "roblox_listing_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "upload_record_id" uuid NOT NULL,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "checked_by" uuid,
  "http_status" integer,
  "is_for_sale" boolean,
  "price_robux" integer,
  "roblox_name" text,
  "asset_type_id" integer,
  "creator_name" text,
  -- Our own tick at the moment of the check, so the comparison survives later ticks.
  "our_on_sale" boolean NOT NULL,
  "error" text
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roblox_listing_checks_upload_record_id_fk') THEN
    ALTER TABLE "roblox_listing_checks" ADD CONSTRAINT "roblox_listing_checks_upload_record_id_fk" FOREIGN KEY ("upload_record_id") REFERENCES "public"."upload_records"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roblox_listing_checks_checked_by_personnel_id_fk') THEN
    ALTER TABLE "roblox_listing_checks" ADD CONSTRAINT "roblox_listing_checks_checked_by_personnel_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "roblox_listing_checks_listing_time_idx" ON "roblox_listing_checks" USING btree ("upload_record_id", "checked_at");
