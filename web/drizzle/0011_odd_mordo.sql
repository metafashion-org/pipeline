ALTER TABLE "assignments" ADD COLUMN "ai_generated_brief_draft" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "ai_brief_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "ai_brief_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "ai_brief_accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_ai_brief_accepted_by_personnel_id_fk" FOREIGN KEY ("ai_brief_accepted_by") REFERENCES "public"."personnel"("id") ON DELETE no action ON UPDATE no action;