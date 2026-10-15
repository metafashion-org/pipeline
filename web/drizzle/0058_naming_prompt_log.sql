-- The exact prompt sent to Claude for a naming suggestion and Claude's raw answer, so the owner can
-- read what Claude was given and what it said. Images are listed by Drive file id, not stored.
--
-- Additive only.

ALTER TABLE "name_proposals" ADD COLUMN IF NOT EXISTS "prompt_log" text;
ALTER TABLE "name_proposals" ADD COLUMN IF NOT EXISTS "response_log" text;
