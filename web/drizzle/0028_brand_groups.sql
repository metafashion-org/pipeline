-- Which Roblox creator group/brand an asset uploads to — admin-configurable (not hardcoded),
-- matching this app's existing pattern for statuses/categories/artifact types. The uploader is
-- who actually needs this to be reliable, so it's a real managed list, not free text.
--
-- Written idempotently, like 0019-0027, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

CREATE TABLE IF NOT EXISTS "brand_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "roblox_group_url" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_groups_name_unique') THEN
    ALTER TABLE "brand_groups" ADD CONSTRAINT "brand_groups_name_unique" UNIQUE ("name");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "brand_group_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_brand_group_id_brand_groups_id_fk') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_brand_group_id_brand_groups_id_fk"
      FOREIGN KEY ("brand_group_id") REFERENCES "brand_groups"("id");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "assets_brand_group_idx" ON "assets" ("brand_group_id");
