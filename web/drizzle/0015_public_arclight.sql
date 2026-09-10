-- Idempotent: the live database has been maintained with `drizzle-kit push`, so this constraint
-- already exists there while drizzle.__drizzle_migrations has no record of this file. Guarded so
-- `pnpm db:migrate` replays cleanly over that database as well as building a fresh one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_cycles_cycle_date_unique') THEN
    ALTER TABLE "payment_cycles" ADD CONSTRAINT "payment_cycles_cycle_date_unique" UNIQUE("cycle_date");
  END IF;
END $$;
