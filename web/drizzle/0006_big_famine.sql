ALTER TABLE "assignments" ADD COLUMN "unassigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "unassigned_reason" text;--> statement-breakpoint
ALTER TABLE "status_transition_rules" ADD COLUMN "from_status_key" text;--> statement-breakpoint
ALTER TABLE "status_transition_rules" ADD COLUMN "to_status_key" text;--> statement-breakpoint
ALTER TABLE "status_transition_rules" ADD COLUMN "is_allowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "status_transition_rules" ADD COLUMN "failure_reason" text;