-- Final files an artist hands in: one row per file, pointing at the file in the Shared Drive under
-- "Meta Fashion Pipeline — <SKU>/Final Files/v<version>/". Each submission is a new version.
--
-- Written idempotently, like 0019-0031, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

CREATE TABLE IF NOT EXISTS "asset_deliverables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text,
  "size_bytes" bigint,
  "drive_file_id" text NOT NULL,
  "drive_url" text NOT NULL,
  "drive_folder_id" text NOT NULL,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_deliverables_asset_id_assets_id_fk') THEN
    ALTER TABLE "asset_deliverables" ADD CONSTRAINT "asset_deliverables_asset_id_assets_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_deliverables_uploaded_by_personnel_id_fk') THEN
    ALTER TABLE "asset_deliverables" ADD CONSTRAINT "asset_deliverables_uploaded_by_personnel_id_fk"
      FOREIGN KEY ("uploaded_by") REFERENCES "personnel"("id");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "asset_deliverables_asset_version_idx" ON "asset_deliverables" ("asset_id", "version");
