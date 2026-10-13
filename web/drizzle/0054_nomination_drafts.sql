-- Today's Picks nomination drafts (stages 2 and 3): Arjun's approved final name and reviewed form
-- answers per SKU, the history of every change and confirmation, and suggestions read from the
-- private sheet's Suggestions tab.
--
-- nomination_drafts: one row per nomination attempt of an asset. attempt_no 1 is the first
-- nomination; a later attempt is a re-nomination after a change. At most one attempt per asset is
-- open (not submitted or withdrawn), enforced by the partial unique index.
-- nomination_events: append-only history. (draft_id, event_key) is unique so a retried request
-- can't record the same event twice.
-- marketing_suggestions: one row per distinct suggestion read from the sheet; row_hash is unique so
-- re-reading the sheet adds nothing new. A suggestion never changes a draft by itself.
--
-- Additive only. Written idempotently, like 0019-0053.

CREATE TABLE IF NOT EXISTS "nomination_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  "attempt_no" integer NOT NULL,
  "state" text DEFAULT 'draft' NOT NULL,
  "form_version" text NOT NULL,
  "fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "renomination_reason" text,
  "submitted_at" timestamp with time zone,
  "submitted_by" uuid,
  "submission_evidence" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "nomination_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" uuid NOT NULL,
  "event_key" text NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "marketing_suggestions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  "listing_id" uuid,
  "field" text NOT NULL,
  "value" text NOT NULL,
  "evidence" text,
  "suggested_by" text,
  "suggested_at" text,
  "row_hash" text NOT NULL,
  "status" text DEFAULT 'new' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nomination_drafts_asset_id_fk') THEN
    ALTER TABLE "nomination_drafts" ADD CONSTRAINT "nomination_drafts_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nomination_drafts_submitted_by_fk') THEN
    ALTER TABLE "nomination_drafts" ADD CONSTRAINT "nomination_drafts_submitted_by_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nomination_drafts_created_by_fk') THEN
    ALTER TABLE "nomination_drafts" ADD CONSTRAINT "nomination_drafts_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nomination_events_draft_id_fk') THEN
    ALTER TABLE "nomination_events" ADD CONSTRAINT "nomination_events_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."nomination_drafts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nomination_events_actor_id_fk') THEN
    ALTER TABLE "nomination_events" ADD CONSTRAINT "nomination_events_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_suggestions_asset_id_fk') THEN
    ALTER TABLE "marketing_suggestions" ADD CONSTRAINT "marketing_suggestions_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "nomination_drafts_asset_attempt_idx" ON "nomination_drafts" USING btree ("asset_id", "attempt_no");
-- One open attempt per asset.
CREATE UNIQUE INDEX IF NOT EXISTS "nomination_drafts_one_open_idx" ON "nomination_drafts" USING btree ("asset_id") WHERE "state" = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS "nomination_events_draft_key_idx" ON "nomination_events" USING btree ("draft_id", "event_key");
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_suggestions_row_hash_idx" ON "marketing_suggestions" USING btree ("row_hash");
CREATE INDEX IF NOT EXISTS "marketing_suggestions_asset_idx" ON "marketing_suggestions" USING btree ("asset_id");

-- Same as every other table: the app reaches Postgres directly, never through Supabase's REST API.
ALTER TABLE "nomination_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nomination_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_suggestions" ENABLE ROW LEVEL SECURITY;
