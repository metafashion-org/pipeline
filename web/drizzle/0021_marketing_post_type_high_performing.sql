ALTER TABLE "marketing_updates" ADD COLUMN "post_type" text;
--> statement-breakpoint
ALTER TABLE "marketing_updates" ADD COLUMN "high_performing" boolean DEFAULT false NOT NULL;
