-- The brief fields (rig, technical specs, target wearer, notes and the rest, as configured on
-- Settings > Curation fields) for an asset added from the board. Until now they only existed on a
-- curation idea, so assets added with New Asset never sent them to the artist.
--
-- Additive only. Written idempotently, like 0019-0046.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "brief_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;
