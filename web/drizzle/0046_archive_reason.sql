-- Why a card was taken off the board ("archived"), shown on the board's Archived list next to who
-- archived it and when. Null for cards hidden before this column existed, and cleared when a card is
-- put back.
--
-- Additive only. Written idempotently, like 0019-0045.

ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "board_hidden_reason" text;
