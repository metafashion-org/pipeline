-- The list an asset's Category field is picked from, instead of free text — same
-- admin-configurable pattern as 0028_brand_groups. Seeded with Roblox's 8 standard rigid/layered
-- accessory attachment points, since every category assets.category has actually held so far
-- (Face, Hat, Neck, Waist, Front, back) is one of these, just entered inconsistently — exactly
-- the problem a managed list fixes.
--
-- Written idempotently, like 0019-0029, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

CREATE TABLE IF NOT EXISTS "categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_name_unique') THEN
    ALTER TABLE "categories" ADD CONSTRAINT "categories_name_unique" UNIQUE ("name");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

INSERT INTO "categories" ("name", "sort_order") VALUES
  ('Hat (caps, crowns, headwear)', 0),
  ('Hair (wigs, hairstyles, hairpieces)', 1),
  ('Face Accessory (glasses, masks, piercings)', 2),
  ('Neck Accessory (chokers, necklaces, scarves)', 3),
  ('Shoulder Accessory (epaulettes, capes, backpacks worn high)', 4),
  ('Back Accessory (backpacks, wings, capes)', 5),
  ('Front Accessory (bags, corsages, satchels)', 6),
  ('Waist Accessory (belts, chains, skirts-as-accessory)', 7)
ON CONFLICT ("name") DO NOTHING;
