-- Keys that let an outside tool (Instinct, the AI assistant) call a small set of API routes
-- without a Google sign-in. Only a SHA-256 hash of each key is stored; the key itself is shown
-- once when it is made in Settings. Each key acts as one personnel row, so what it does is
-- attributed to that person, and it can be revoked.
--
-- New table only. Written idempotently, like 0019-0042.

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "personnel_id" uuid NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_personnel_id_fk') THEN
    ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_personnel_id_fk"
      FOREIGN KEY ("personnel_id") REFERENCES "public"."personnel"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_created_by_fk') THEN
    ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_idx" ON "api_keys" ("key_hash");
