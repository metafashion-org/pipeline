ALTER TABLE "curation_item_ideas" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE "curation_idea_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"idea_title" text NOT NULL,
	"category" text,
	"trend_reasoning" text,
	"source_links" text[] DEFAULT '{}',
	"moodboard_urls" text[] DEFAULT '{}',
	"field_values" jsonb DEFAULT '{}'::jsonb,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curation_idea_versions" ADD CONSTRAINT "curation_idea_versions_idea_id_curation_item_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."curation_item_ideas"("id") ON DELETE cascade ON UPDATE no action;
