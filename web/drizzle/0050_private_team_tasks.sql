-- Private Team Tasks: a task only its owner, its creator and its helpers see, kept on the same
-- board as everything else. Hidden from everyone else's board, search, week view, link picker,
-- Registry task list and the daily summary posted to #office.
--
-- Additive only. Written idempotently, like 0019-0049.

ALTER TABLE "team_tasks" ADD COLUMN IF NOT EXISTS "is_private" boolean DEFAULT false NOT NULL;
