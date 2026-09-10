-- Written idempotently: the live database has been maintained with `drizzle-kit push` since
-- 2026-08-10, so drizzle.__drizzle_migrations stops at 15 entries while these objects already
-- exist in production. `pnpm db:migrate` has to be safe to run against that database as well as
-- against a fresh one.
CREATE TABLE IF NOT EXISTS "discord_temp_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"grantee_type" text NOT NULL,
	"grantee_id" text NOT NULL,
	"grantee_name" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"granted_by" text,
	"prior_overwrite" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personnel" ADD COLUMN IF NOT EXISTS "discord_user_id" text;
