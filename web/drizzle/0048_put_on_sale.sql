-- Putting an asset on sale on Roblox, recolour by recolour. Adds:
--   - on upload_records (one row per Roblox link, so one per uploaded recolour):
--       variant_label: which recolour the link is, e.g. "Red". Optional.
--       on_sale_at / on_sale_by: when and by whom Arjun put that link on sale. Null while it isn't.
--   - the "put_on_sale" status, labelled "Put on Sale", after Payment Done as the last column
--   - its one rule: Payment Done -> Put on Sale, made by an admin
--   - Payment Done's texts, which said it was the last step
--
-- Additive only. Written idempotently, like 0019-0047.

ALTER TABLE "upload_records" ADD COLUMN IF NOT EXISTS "variant_label" text;
ALTER TABLE "upload_records" ADD COLUMN IF NOT EXISTS "on_sale_at" timestamp with time zone;
ALTER TABLE "upload_records" ADD COLUMN IF NOT EXISTS "on_sale_by" uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_records_on_sale_by_fk') THEN
    ALTER TABLE "upload_records" ADD CONSTRAINT "upload_records_on_sale_by_fk"
      FOREIGN KEY ("on_sale_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The drawer lists an asset's links.
CREATE INDEX IF NOT EXISTS "upload_records_asset_idx" ON "upload_records" ("asset_id", "created_at");

UPDATE "statuses" SET
  "description" = 'The artist has been paid. Arjun then puts the recolours he chooses on sale.',
  "next_action_hint" = 'Arjun ticks which recolours are on sale and presses Done, which moves it to Put on Sale.'
  WHERE "key" = 'payment_done';

INSERT INTO "statuses" ("key", "label", "sort_order", "description", "who_can_move_in", "next_action_hint", "automation_note")
VALUES (
  'put_on_sale',
  'Put on Sale',
  12,
  'Arjun has put the recolours he chose on sale on Roblox. Uploaded recolours can stay off sale. This is the last step.',
  ARRAY['admin'],
  NULL,
  'Only Arjun moves cards here, from Payment Done, with Done on the card''s Roblox links.'
)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "sort_order" = EXCLUDED."sort_order",
  "description" = EXCLUDED."description",
  "who_can_move_in" = EXCLUDED."who_can_move_in",
  "next_action_hint" = EXCLUDED."next_action_hint",
  "automation_note" = EXCLUDED."automation_note";

INSERT INTO "status_transition_rules" ("from_status", "to_status", "role", "is_automatic", "trigger_note")
SELECT 'payment_done', 'put_on_sale', 'admin', false, 'Arjun puts the chosen recolours on sale.'
WHERE NOT EXISTS (SELECT 1 FROM "status_transition_rules" WHERE "from_status" = 'payment_done' AND "to_status" = 'put_on_sale');
