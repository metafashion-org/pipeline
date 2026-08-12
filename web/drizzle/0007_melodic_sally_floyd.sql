CREATE TABLE "marketing_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"post_url" text,
	"caption" text,
	"marketing_status" text NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb,
	"notes" text,
	"responsible_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_status_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status_key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_status_config_status_key_unique" UNIQUE("status_key")
);
--> statement-breakpoint
CREATE TABLE "guidelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"guideline_type" text NOT NULL,
	"content_markdown" text NOT NULL,
	"linked_asset_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_updates" ADD CONSTRAINT "marketing_updates_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_updates" ADD CONSTRAINT "marketing_updates_responsible_person_id_personnel_id_fk" FOREIGN KEY ("responsible_person_id") REFERENCES "public"."personnel"("id") ON DELETE no action ON UPDATE no action;