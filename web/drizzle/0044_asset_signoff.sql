-- Arjun signs off every asset someone else adds before it goes on the board. Adds:
--   - asset_signoffs: one row per asset waiting for (or past) sign-off: who added it, when it was
--     last sent for sign-off, and Arjun's decision and feedback
--   - the "curated" status, labelled "Waiting for sign-off", ordered before Unassigned. Assets in it
--     are not shown on the board; they're on the Sign-off page.
--   - its one rule: Waiting for sign-off -> Unassigned, made by an admin
--
-- Additive only. Written idempotently, like 0019-0043.

CREATE TABLE IF NOT EXISTS "asset_signoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  "submitted_by" uuid,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "state" text DEFAULT 'waiting' NOT NULL,
  "feedback" text,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_signoffs_asset_id_fk') THEN
    ALTER TABLE "asset_signoffs" ADD CONSTRAINT "asset_signoffs_asset_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_signoffs_submitted_by_fk') THEN
    ALTER TABLE "asset_signoffs" ADD CONSTRAINT "asset_signoffs_submitted_by_fk"
      FOREIGN KEY ("submitted_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_signoffs_decided_by_fk') THEN
    ALTER TABLE "asset_signoffs" ADD CONSTRAINT "asset_signoffs_decided_by_fk"
      FOREIGN KEY ("decided_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- One sign-off row per asset; a resubmission updates it.
CREATE UNIQUE INDEX IF NOT EXISTS "asset_signoffs_asset_idx" ON "asset_signoffs" ("asset_id");
CREATE INDEX IF NOT EXISTS "asset_signoffs_state_idx" ON "asset_signoffs" ("state", "submitted_at");

INSERT INTO "statuses" ("key", "label", "sort_order", "description", "who_can_move_in", "next_action_hint", "automation_note")
VALUES (
  'curated',
  'Waiting for sign-off',
  0,
  'Assets added by the team, waiting for Arjun to sign them off before they go on the board.',
  ARRAY['admin'],
  'Arjun approves it onto the board (Unassigned), sends it back with feedback, or drops it, on the Sign-off page.',
  'Assets added by anyone but an admin land here. They are not shown on the board.'
)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "who_can_move_in" = EXCLUDED."who_can_move_in",
  "next_action_hint" = EXCLUDED."next_action_hint",
  "automation_note" = EXCLUDED."automation_note";

-- Only an admin signs an asset off onto the board. An older "operator" rule from the curation
-- review trial, if one exists, is narrowed to admin.
UPDATE "status_transition_rules" SET "role" = 'admin', "trigger_note" = 'Arjun signs the asset off onto the board.'
  WHERE "from_status" = 'curated' AND "to_status" = 'unassigned';
INSERT INTO "status_transition_rules" ("from_status", "to_status", "role", "is_automatic", "trigger_note")
SELECT 'curated', 'unassigned', 'admin', false, 'Arjun signs the asset off onto the board.'
WHERE NOT EXISTS (SELECT 1 FROM "status_transition_rules" WHERE "from_status" = 'curated' AND "to_status" = 'unassigned');
