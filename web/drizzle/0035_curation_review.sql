-- Curation review, a trial an admin switches Off, Admins only or Everyone in Settings. While it's on,
-- a curator's submitted idea lands in a Curated column for the team to approve into Unassigned or
-- send back with a note. Adds:
--   - app_settings, one row per app-wide switch (the trial's mode is the only one so far)
--   - curation_item_ideas.review_note, the team's note when they send an idea back
--
-- Apply this before deploying the code that reads review_note. The code before it selects only the
-- columns it knows, so the extra column changes nothing for it.
--
-- The Curated status, its rule and the "Pinterest board" curation field are not added here. They
-- are created the first time an admin turns the switch on (ensureCurationReviewConfig in
-- lib/settings/app-settings.ts), so no Curated column appears anywhere before someone asks for it.
--
-- Written idempotently, like 0019-0034, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_settings_updated_by_personnel_id_fk') THEN
    ALTER TABLE "app_settings"
      ADD CONSTRAINT "app_settings_updated_by_personnel_id_fk"
      FOREIGN KEY ("updated_by") REFERENCES "public"."personnel"("id") ON DELETE no action ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

ALTER TABLE "curation_item_ideas" ADD COLUMN IF NOT EXISTS "review_note" text;
