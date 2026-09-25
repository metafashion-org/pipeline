-- The day the team plans to upload an asset to Roblox, for the company asset calendar.
--
-- Written idempotently, like 0019-0032, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "planned_upload_date" timestamp with time zone;
