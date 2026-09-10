-- One review list for onboarding requests, whichever way they arrive.
--
-- Written idempotently, like 0019-0026, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

CREATE TABLE IF NOT EXISTS "onboarding_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "name" text,
  "email" text,
  "discord_user_id" text,
  "discord_username" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "personnel_id" uuid,
  "reviewed_by" uuid,
  "review_notes" text,
  "reviewed_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "requested_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_requests_personnel_id_personnel_id_fk') THEN
    ALTER TABLE "onboarding_requests"
      ADD CONSTRAINT "onboarding_requests_personnel_id_personnel_id_fk"
      FOREIGN KEY ("personnel_id") REFERENCES "personnel"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_requests_reviewed_by_personnel_id_fk') THEN
    ALTER TABLE "onboarding_requests"
      ADD CONSTRAINT "onboarding_requests_reviewed_by_personnel_id_fk"
      FOREIGN KEY ("reviewed_by") REFERENCES "personnel"("id");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

--> statement-breakpoint

-- One row per request per source. This is what lets the sync run as often as it likes: a request
-- already pulled in updates its own row instead of arriving a second time.
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_requests_source_external_idx"
  ON "onboarding_requests" ("source", "external_id");--> statement-breakpoint

-- The review list reads pending requests, oldest first.
CREATE INDEX IF NOT EXISTS "onboarding_requests_status_idx"
  ON "onboarding_requests" ("status", "first_seen_at");
