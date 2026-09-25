-- Asset offers: an artist is offered an asset (name, image, SKU, accessory type, fee, deadline),
-- and accepts it, asks for a later deadline for the team to approve, or declines with an optional
-- reason. One row per offer; a reassignment withdraws the old row and adds a new one.
--
-- Written idempotently, like 0019-0030, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

CREATE TABLE IF NOT EXISTS "asset_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  "assignment_id" uuid,
  "artist_id" uuid NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "offered_deadline" timestamp with time zone NOT NULL,
  "fee_amount" numeric(10, 2),
  "currency" text,
  "requested_deadline" timestamp with time zone,
  "extension_reason" text,
  "extension_decision" text,
  "extension_decided_at" timestamp with time zone,
  "extension_decided_by" uuid,
  "agreed_deadline" timestamp with time zone,
  "decline_reason" text,
  "responded_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_offers_asset_id_assets_id_fk') THEN
    ALTER TABLE "asset_offers" ADD CONSTRAINT "asset_offers_asset_id_assets_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_offers_assignment_id_assignments_id_fk') THEN
    ALTER TABLE "asset_offers" ADD CONSTRAINT "asset_offers_assignment_id_assignments_id_fk"
      FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE set null;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_offers_artist_id_personnel_id_fk') THEN
    ALTER TABLE "asset_offers" ADD CONSTRAINT "asset_offers_artist_id_personnel_id_fk"
      FOREIGN KEY ("artist_id") REFERENCES "personnel"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_offers_extension_decided_by_personnel_id_fk') THEN
    ALTER TABLE "asset_offers" ADD CONSTRAINT "asset_offers_extension_decided_by_personnel_id_fk"
      FOREIGN KEY ("extension_decided_by") REFERENCES "personnel"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_offers_created_by_personnel_id_fk') THEN
    ALTER TABLE "asset_offers" ADD CONSTRAINT "asset_offers_created_by_personnel_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "personnel"("id");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "asset_offers_artist_status_idx" ON "asset_offers" ("artist_id", "status");
CREATE INDEX IF NOT EXISTS "asset_offers_asset_created_idx" ON "asset_offers" ("asset_id", "created_at");
