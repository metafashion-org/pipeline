-- Artists keep their payment and identity details on the Kanban (My details), replacing the Team
-- Onboarding Google Form. Adds:
--   - artist_profiles: one row per artist; UPI, bank account, IFSC, PAN, mobile, portfolio, and the
--     documents (Aadhaar, PAN, cancelled cheque, resume, IP agreement), and the signed NDA as a
--     link, an uploaded PDF, or both
--   - artist_profile_files: each uploaded document, as a Drive link and a copy of the file's bytes
--   - artist_profile_change_requests: a change to saved details, with the artist's reason; it only
--     replaces the saved details once someone who pays artists approves it
--
-- New tables only. Written idempotently, like 0019-0041.

CREATE TABLE IF NOT EXISTS "artist_profile_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "personnel_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text,
  "size_bytes" integer,
  "drive_url" text,
  "bytes" bytea,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "artist_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "personnel_id" uuid NOT NULL,
  "mobile" text,
  "upi_id" text,
  "account_holder_name" text,
  "bank_account_number" text,
  "ifsc" text,
  "bank_name" text,
  "pan_number" text,
  "portfolio_links" text,
  "aadhaar_file_id" uuid,
  "pan_file_id" uuid,
  "cheque_file_id" uuid,
  "resume_file_id" uuid,
  "ip_agreement_file_id" uuid,
  "nda_url" text,
  "nda_file_id" uuid,
  "submitted_at" timestamp with time zone,
  "imported_from_form_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "artist_profile_change_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "personnel_id" uuid NOT NULL,
  "changes" jsonb NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artist_profile_files_personnel_id_fk') THEN
    ALTER TABLE "artist_profile_files" ADD CONSTRAINT "artist_profile_files_personnel_id_fk"
      FOREIGN KEY ("personnel_id") REFERENCES "public"."personnel"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artist_profile_files_uploaded_by_fk') THEN
    ALTER TABLE "artist_profile_files" ADD CONSTRAINT "artist_profile_files_uploaded_by_fk"
      FOREIGN KEY ("uploaded_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artist_profiles_personnel_id_fk') THEN
    ALTER TABLE "artist_profiles" ADD CONSTRAINT "artist_profiles_personnel_id_fk"
      FOREIGN KEY ("personnel_id") REFERENCES "public"."personnel"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artist_profile_change_requests_personnel_id_fk') THEN
    ALTER TABLE "artist_profile_change_requests" ADD CONSTRAINT "artist_profile_change_requests_personnel_id_fk"
      FOREIGN KEY ("personnel_id") REFERENCES "public"."personnel"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artist_profile_change_requests_decided_by_fk') THEN
    ALTER TABLE "artist_profile_change_requests" ADD CONSTRAINT "artist_profile_change_requests_decided_by_fk"
      FOREIGN KEY ("decided_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- One profile per artist.
CREATE UNIQUE INDEX IF NOT EXISTS "artist_profiles_personnel_idx" ON "artist_profiles" ("personnel_id");
CREATE INDEX IF NOT EXISTS "artist_profile_files_personnel_idx" ON "artist_profile_files" ("personnel_id");
CREATE INDEX IF NOT EXISTS "artist_profile_change_requests_status_idx" ON "artist_profile_change_requests" ("status", "personnel_id");
