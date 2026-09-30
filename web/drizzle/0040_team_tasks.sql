-- Team Tasks: day-to-day work for the full-time team (anyone with the full_time role), separate
-- from the asset board. Adds:
--   - team_task_recurrences: a task that repeats on set weekdays, optionally with a daily target
--     (e.g. curate 45) and a focus for a season (e.g. Christmas until 31 Dec)
--   - team_tasks: one task; its place in the owner's list is its priority (position)
--   - team_task_helpers: people helping the owner
--   - team_task_subtasks: a task's checklist, each item optionally with its own owner and due date
--   - team_task_links: links from a task to another task, an asset (SKU) or a Registry artifact
--   - team_task_comments: updates and discussion, with the people @mentioned
--   - team_task_day_plans: what each person picked for a day, in order; kept per date, so any
--     day's plan can be looked back on
--   - team_notifications: what each person was told (a mention, a task given to them), also sent
--     by email and on Discord
--
-- New tables only; nothing existing changes. Written idempotently, like 0019-0039.

CREATE TABLE IF NOT EXISTS "team_task_recurrences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "notes" text,
  "area" text NOT NULL,
  "owner_id" uuid NOT NULL,
  -- 0 = Sunday ... 6 = Saturday, as Date.getDay() numbers them.
  "weekdays" integer[] DEFAULT '{}'::integer[] NOT NULL,
  "target_count" integer,
  "focus" text,
  "focus_until" date,
  "starts_on" date NOT NULL,
  "ends_on" date,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "notes" text,
  "area" text NOT NULL,
  "status" text DEFAULT 'todo' NOT NULL,
  "waiting_on" text,
  "owner_id" uuid NOT NULL,
  "due_on" date,
  "position" integer DEFAULT 0 NOT NULL,
  "target_count" integer,
  "done_count" integer DEFAULT 0 NOT NULL,
  "focus" text,
  "recurrence_id" uuid,
  "occurrence_on" date,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_task_helpers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "personnel_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_task_subtasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "title" text NOT NULL,
  "owner_id" uuid,
  "due_on" date,
  "done_at" timestamp with time zone,
  "position" integer DEFAULT 0 NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_task_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "linked_task_id" uuid,
  "asset_id" uuid,
  "artifact_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Exactly one target per link.
  CONSTRAINT "team_task_links_one_target" CHECK (num_nonnulls("linked_task_id", "asset_id", "artifact_id") = 1)
);

CREATE TABLE IF NOT EXISTS "team_task_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "author_id" uuid,
  "body" text NOT NULL,
  "mentioned_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_task_day_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_on" date NOT NULL,
  "personnel_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "team_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_id" uuid NOT NULL,
  "task_id" uuid,
  "kind" text NOT NULL,
  "actor_id" uuid,
  "message" text NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Foreign keys. Deleting a task takes its helpers, subtasks, links, comments, plan rows and
-- notifications with it; a person or asset can't be deleted while a task still points at them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_recurrences_owner_id_fk') THEN
    ALTER TABLE "team_task_recurrences" ADD CONSTRAINT "team_task_recurrences_owner_id_fk"
      FOREIGN KEY ("owner_id") REFERENCES "public"."personnel"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_recurrences_created_by_fk') THEN
    ALTER TABLE "team_task_recurrences" ADD CONSTRAINT "team_task_recurrences_created_by_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_tasks_owner_id_fk') THEN
    ALTER TABLE "team_tasks" ADD CONSTRAINT "team_tasks_owner_id_fk"
      FOREIGN KEY ("owner_id") REFERENCES "public"."personnel"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_tasks_created_by_fk') THEN
    ALTER TABLE "team_tasks" ADD CONSTRAINT "team_tasks_created_by_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_tasks_recurrence_id_fk') THEN
    ALTER TABLE "team_tasks" ADD CONSTRAINT "team_tasks_recurrence_id_fk"
      FOREIGN KEY ("recurrence_id") REFERENCES "public"."team_task_recurrences"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_helpers_task_id_fk') THEN
    ALTER TABLE "team_task_helpers" ADD CONSTRAINT "team_task_helpers_task_id_fk"
      FOREIGN KEY ("task_id") REFERENCES "public"."team_tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_helpers_personnel_id_fk') THEN
    ALTER TABLE "team_task_helpers" ADD CONSTRAINT "team_task_helpers_personnel_id_fk"
      FOREIGN KEY ("personnel_id") REFERENCES "public"."personnel"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_subtasks_task_id_fk') THEN
    ALTER TABLE "team_task_subtasks" ADD CONSTRAINT "team_task_subtasks_task_id_fk"
      FOREIGN KEY ("task_id") REFERENCES "public"."team_tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_subtasks_owner_id_fk') THEN
    ALTER TABLE "team_task_subtasks" ADD CONSTRAINT "team_task_subtasks_owner_id_fk"
      FOREIGN KEY ("owner_id") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_subtasks_created_by_fk') THEN
    ALTER TABLE "team_task_subtasks" ADD CONSTRAINT "team_task_subtasks_created_by_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_links_task_id_fk') THEN
    ALTER TABLE "team_task_links" ADD CONSTRAINT "team_task_links_task_id_fk"
      FOREIGN KEY ("task_id") REFERENCES "public"."team_tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_links_linked_task_id_fk') THEN
    ALTER TABLE "team_task_links" ADD CONSTRAINT "team_task_links_linked_task_id_fk"
      FOREIGN KEY ("linked_task_id") REFERENCES "public"."team_tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_links_asset_id_fk') THEN
    ALTER TABLE "team_task_links" ADD CONSTRAINT "team_task_links_asset_id_fk"
      FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_links_artifact_id_fk') THEN
    ALTER TABLE "team_task_links" ADD CONSTRAINT "team_task_links_artifact_id_fk"
      FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_links_created_by_fk') THEN
    ALTER TABLE "team_task_links" ADD CONSTRAINT "team_task_links_created_by_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_comments_task_id_fk') THEN
    ALTER TABLE "team_task_comments" ADD CONSTRAINT "team_task_comments_task_id_fk"
      FOREIGN KEY ("task_id") REFERENCES "public"."team_tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_comments_author_id_fk') THEN
    ALTER TABLE "team_task_comments" ADD CONSTRAINT "team_task_comments_author_id_fk"
      FOREIGN KEY ("author_id") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_day_plans_task_id_fk') THEN
    ALTER TABLE "team_task_day_plans" ADD CONSTRAINT "team_task_day_plans_task_id_fk"
      FOREIGN KEY ("task_id") REFERENCES "public"."team_tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_task_day_plans_personnel_id_fk') THEN
    ALTER TABLE "team_task_day_plans" ADD CONSTRAINT "team_task_day_plans_personnel_id_fk"
      FOREIGN KEY ("personnel_id") REFERENCES "public"."personnel"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_notifications_recipient_id_fk') THEN
    ALTER TABLE "team_notifications" ADD CONSTRAINT "team_notifications_recipient_id_fk"
      FOREIGN KEY ("recipient_id") REFERENCES "public"."personnel"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_notifications_task_id_fk') THEN
    ALTER TABLE "team_notifications" ADD CONSTRAINT "team_notifications_task_id_fk"
      FOREIGN KEY ("task_id") REFERENCES "public"."team_tasks"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_notifications_actor_id_fk') THEN
    ALTER TABLE "team_notifications" ADD CONSTRAINT "team_notifications_actor_id_fk"
      FOREIGN KEY ("actor_id") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- One task per recurrence per day, so making the day's recurring tasks twice makes them once.
CREATE UNIQUE INDEX IF NOT EXISTS "team_tasks_recurrence_day_idx" ON "team_tasks" ("recurrence_id", "occurrence_on");
-- The board reads each owner's open tasks, and today's done ones.
CREATE INDEX IF NOT EXISTS "team_tasks_owner_status_idx" ON "team_tasks" ("owner_id", "status");
CREATE INDEX IF NOT EXISTS "team_tasks_completed_at_idx" ON "team_tasks" ("completed_at");
CREATE UNIQUE INDEX IF NOT EXISTS "team_task_helpers_task_person_idx" ON "team_task_helpers" ("task_id", "personnel_id");
CREATE INDEX IF NOT EXISTS "team_task_subtasks_task_idx" ON "team_task_subtasks" ("task_id");
CREATE INDEX IF NOT EXISTS "team_task_subtasks_owner_idx" ON "team_task_subtasks" ("owner_id");
CREATE INDEX IF NOT EXISTS "team_task_links_task_idx" ON "team_task_links" ("task_id");
CREATE INDEX IF NOT EXISTS "team_task_links_linked_task_idx" ON "team_task_links" ("linked_task_id");
CREATE INDEX IF NOT EXISTS "team_task_links_artifact_idx" ON "team_task_links" ("artifact_id");
CREATE UNIQUE INDEX IF NOT EXISTS "team_task_links_task_task_idx" ON "team_task_links" ("task_id", "linked_task_id");
CREATE UNIQUE INDEX IF NOT EXISTS "team_task_links_task_asset_idx" ON "team_task_links" ("task_id", "asset_id");
CREATE UNIQUE INDEX IF NOT EXISTS "team_task_links_task_artifact_idx" ON "team_task_links" ("task_id", "artifact_id");
CREATE INDEX IF NOT EXISTS "team_task_comments_task_idx" ON "team_task_comments" ("task_id", "created_at");
-- A task appears once in a person's plan for a day.
CREATE UNIQUE INDEX IF NOT EXISTS "team_task_day_plans_day_person_task_idx" ON "team_task_day_plans" ("plan_on", "personnel_id", "task_id");
CREATE INDEX IF NOT EXISTS "team_notifications_recipient_idx" ON "team_notifications" ("recipient_id", "read_at");
