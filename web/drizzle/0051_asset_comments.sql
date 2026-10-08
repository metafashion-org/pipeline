-- Comments on an asset's card, with @mentions of the team and freelancers. A team member's
-- mention also lands in the Team Tasks bell, so team_notifications gains an asset_id beside task_id.
--
-- Additive only. Written idempotently, like 0019-0050.

CREATE TABLE IF NOT EXISTS "asset_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" uuid NOT NULL,
  "author_id" uuid,
  "body" text NOT NULL,
  "mentioned_ids" uuid[] DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_comments_asset_id_assets_id_fk') THEN
    ALTER TABLE "asset_comments" ADD CONSTRAINT "asset_comments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_comments_author_id_personnel_id_fk') THEN
    ALTER TABLE "asset_comments" ADD CONSTRAINT "asset_comments_author_id_personnel_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."personnel"("id") ON DELETE set null ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "asset_comments_asset_idx" ON "asset_comments" USING btree ("asset_id", "created_at");

ALTER TABLE "team_notifications" ADD COLUMN IF NOT EXISTS "asset_id" uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_notifications_asset_id_assets_id_fk') THEN
    ALTER TABLE "team_notifications" ADD CONSTRAINT "team_notifications_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
