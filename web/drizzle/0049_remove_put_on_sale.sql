-- Putting an asset on sale is a property of each recolour link (upload_records.on_sale_at, from
-- 0048), not a step every card goes through, so the Put on Sale column comes off the board and
-- Payment Done is the last step again. Ticking recolours on sale moves to the Marketing page and
-- stays on the card. Any card in Put on Sale goes back to Payment Done first (there were none
-- when this was written).

UPDATE "assets" SET "current_status" = 'payment_done', "updated_at" = now() WHERE "current_status" = 'put_on_sale';
DELETE FROM "status_transition_rules" WHERE "to_status" = 'put_on_sale' OR "from_status" = 'put_on_sale';
DELETE FROM "statuses" WHERE "key" = 'put_on_sale';

UPDATE "statuses" SET
  "description" = 'The artist has been paid. This is the last step.',
  "next_action_hint" = NULL
  WHERE "key" = 'payment_done';
