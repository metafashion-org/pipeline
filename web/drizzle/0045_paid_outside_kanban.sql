-- Assets paid before the Kanban tracked payments. Such an asset still goes through final files and
-- the Roblox upload, but once its Roblox link is added it moves straight to Payment Done with no
-- invoice, and the payment summary never counts it as owed.
--
-- Additive only. Written idempotently, like 0019-0044.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "paid_outside_at" timestamp with time zone;
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "paid_outside_note" text;
