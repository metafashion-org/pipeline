-- Lets the team move a card from Revisions Requested straight to Approved once the artist's changes
-- are in. Without this rule the only way out was back through In Production and In Review, three
-- moves for one approval (reported by Jayesh on 30 Sept).
--
-- Written idempotently, like 0019-0035: the rule is only added when missing, and the help text is
-- only replaced while it still reads as 0034 left it, so an edit made in Settings stays.

INSERT INTO "status_transition_rules" ("from_status", "to_status", "role", "is_allowed", "is_automatic", "trigger_note")
SELECT 'revisions_requested', 'approved', 'operator', true, false, 'The team approves the changes once they''re in.'
WHERE NOT EXISTS (
  SELECT 1 FROM "status_transition_rules" WHERE "from_status" = 'revisions_requested' AND "to_status" = 'approved'
);

UPDATE "statuses"
SET "next_action_hint" = 'The artist moves it back to In Production while making the changes. If the changes are already in, the team moves it straight to Approved.'
WHERE "key" = 'revisions_requested'
  AND "next_action_hint" IS NOT DISTINCT FROM 'The artist moves it back to In Production while making the changes.';
