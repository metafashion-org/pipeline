-- Repeating Team Tasks can fall on dates of the month (e.g. the 15th and 30th, for processing
-- freelancer payments), not only on weekdays, and carry helpers. Adds:
--   - team_task_recurrences.month_days: dates of the month, 1-31; a date a month doesn't have falls
--     on its last day
--   - team_task_recurrences.helper_ids: people added as helpers to each task the rule makes
--
-- New columns with defaults only. Written idempotently, like 0019-0040.

ALTER TABLE "team_task_recurrences" ADD COLUMN IF NOT EXISTS "month_days" integer[] DEFAULT '{}'::integer[] NOT NULL;
ALTER TABLE "team_task_recurrences" ADD COLUMN IF NOT EXISTS "helper_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;
