-- Idempotent for the same reason as 0016: this column already exists on the push-maintained
-- live database, and `pnpm db:migrate` has to replay cleanly over it.
ALTER TABLE "personnel" ADD COLUMN IF NOT EXISTS "discord_channel_id" text;
