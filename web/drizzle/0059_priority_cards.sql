-- A card marked priority on the board: highlighted, and its artist is messaged on Discord.
-- Null priority_at means the card isn't a priority.
--
-- Additive only.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "priority_at" timestamp with time zone;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "priority_by" uuid;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "priority_note" text;
DO $$ BEGIN
  ALTER TABLE "assets" ADD CONSTRAINT "assets_priority_by_personnel_id_fk" FOREIGN KEY ("priority_by") REFERENCES "personnel"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
