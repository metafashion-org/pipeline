-- The forms engine grows the three things it needed to replace Google Forms: a stated audience,
-- sections, and a record of who built each form.
--
-- Written idempotently, like 0019-0025, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

-- Audience: 'public' | 'roles' | 'emails'.
--
-- Backfilled from what target_roles already meant, so nothing changes behaviour on the way in: a
-- form with roles becomes 'roles', one without becomes 'public'. The difference from here on is
-- that 'public' is a recorded decision rather than an empty column, which is what let the
-- artifact-submission form end up publicly submittable without anyone choosing that.
ALTER TABLE "form_definitions" ADD COLUMN IF NOT EXISTS "audience" text NOT NULL DEFAULT 'public';--> statement-breakpoint
ALTER TABLE "form_definitions" ADD COLUMN IF NOT EXISTS "allowed_emails" text[] DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "form_definitions" ADD COLUMN IF NOT EXISTS "created_by" uuid;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_definitions_created_by_personnel_id_fk') THEN
    ALTER TABLE "form_definitions"
      ADD CONSTRAINT "form_definitions_created_by_personnel_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "personnel"("id");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

--> statement-breakpoint

-- One-time backfill, guarded so re-running this migration cannot reclassify a form an admin has
-- since changed by hand. Only rows still sitting on the column default are touched.
UPDATE "form_definitions"
SET "audience" = 'roles'
WHERE "audience" = 'public'
  AND "target_roles" IS NOT NULL
  AND array_length("target_roles", 1) > 0;

--> statement-breakpoint

-- Sections, help text and placeholder for fields.
ALTER TABLE "form_fields" ADD COLUMN IF NOT EXISTS "section" text;--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN IF NOT EXISTS "help_text" text;--> statement-breakpoint
ALTER TABLE "form_fields" ADD COLUMN IF NOT EXISTS "placeholder" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "form_definitions_created_idx" ON "form_definitions" ("created_at");
