ALTER TABLE "marketing_updates" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "marketing_updates" ADD COLUMN "creative" text;--> statement-breakpoint
ALTER TABLE "marketing_updates" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_updates" ADD COLUMN "next_action" text;