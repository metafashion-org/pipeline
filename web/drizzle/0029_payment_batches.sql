-- Replaces the 15th/30th payment_cycles snapshot model with a per-artist, on-demand payout
-- ledger: one payment_batches row per "attach payment summary" action, covering every asset that
-- was marked_for_payment for that artist at the time.
--
-- Written idempotently, like 0019-0028, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

CREATE TABLE IF NOT EXISTS "payment_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "artist_id" uuid NOT NULL,
  "receipt_url" text NOT NULL,
  "receipt_file_name" text,
  "total_amount" numeric(12, 2) NOT NULL,
  "currency" text NOT NULL,
  "asset_count" integer NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_batches_artist_id_personnel_id_fk') THEN
    ALTER TABLE "payment_batches"
      ADD CONSTRAINT "payment_batches_artist_id_personnel_id_fk"
      FOREIGN KEY ("artist_id") REFERENCES "personnel"("id");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_batches_created_by_personnel_id_fk') THEN
    ALTER TABLE "payment_batches"
      ADD CONSTRAINT "payment_batches_created_by_personnel_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "personnel"("id");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "payment_batches_artist_idx" ON "payment_batches" ("artist_id");

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "payment_batch_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_payment_batch_id_payment_batches_id_fk') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_payment_batch_id_payment_batches_id_fk"
      FOREIGN KEY ("payment_batch_id") REFERENCES "payment_batches"("id");
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "assets_payment_batch_idx" ON "assets" ("payment_batch_id");
