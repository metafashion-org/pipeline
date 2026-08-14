CREATE TABLE "statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"description" text,
	"who_can_move_in" text[] DEFAULT '{}',
	"next_action_hint" text,
	"automation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statuses_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "status_transition_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"role" text,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"trigger_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
