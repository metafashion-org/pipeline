-- Lets the team take a card off the board without deleting the asset. Adds:
--   - assets.board_hidden_at: when the card was hidden; null while it shows
--   - assets.board_hidden_by: who hid it
-- The board, My Tasks, the calendar, the uploader queue, Submit final files and the Dashboard's
-- open-work counts leave hidden assets out. Payments, history and the asset itself are unchanged,
-- and "Put back" on the board's Hidden cards list clears both columns.
--
-- Apply this before deploying the code that reads these columns. The code before it selects only
-- the columns it knows, so the additions change nothing for it.
--
-- Written idempotently, like 0019-0037, because the live database has been maintained with
-- `drizzle-kit push` as well as by this migration folder.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "board_hidden_at" timestamp with time zone;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "board_hidden_by" uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_board_hidden_by_personnel_id_fk') THEN
    ALTER TABLE "assets"
      ADD CONSTRAINT "assets_board_hidden_by_personnel_id_fk"
      FOREIGN KEY ("board_hidden_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
