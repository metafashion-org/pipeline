-- End-of-day reports: one per person per day, written in Team Tasks and emailed to the team in the
-- evening summary. Tomorrow's tasks are the person's day plan (team_task_day_plans), not stored here.
--
-- Additive only. Written idempotently, like 0019-0051.

CREATE TABLE IF NOT EXISTS "eod_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "personnel_id" uuid NOT NULL,
  "report_on" date NOT NULL,
  "done" text DEFAULT '' NOT NULL,
  "slipped" text DEFAULT '' NOT NULL,
  "blockers" text DEFAULT '' NOT NULL,
  "need_from_manager" text DEFAULT '' NOT NULL,
  "next_outcome" text DEFAULT '' NOT NULL,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eod_reports_personnel_id_personnel_id_fk') THEN
    ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_personnel_id_personnel_id_fk" FOREIGN KEY ("personnel_id") REFERENCES "public"."personnel"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "eod_reports_person_day_idx" ON "eod_reports" USING btree ("personnel_id", "report_on");
