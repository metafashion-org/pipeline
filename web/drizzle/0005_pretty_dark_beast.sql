CREATE TABLE "curation_item_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_title" text NOT NULL,
	"category" text,
	"trend_reasoning" text,
	"source_links" text[] DEFAULT '{}',
	"moodboard_urls" text[] DEFAULT '{}',
	"submitted_by" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curation_field_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_key" text NOT NULL,
	"display_name" text NOT NULL,
	"include_in_artist_email" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curation_field_config_field_key_unique" UNIQUE("field_key")
);
--> statement-breakpoint
CREATE TABLE "knowledge_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"artifact_type" text NOT NULL,
	"file_url" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curation_item_ideas" ADD CONSTRAINT "curation_item_ideas_submitted_by_personnel_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."personnel"("id") ON DELETE no action ON UPDATE no action;