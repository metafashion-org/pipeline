ALTER TABLE "curation_field_config" ADD COLUMN "field_type" text DEFAULT 'text' NOT NULL;
--> statement-breakpoint
ALTER TABLE "curation_field_config" ADD COLUMN "options" jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "curation_field_config" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "curation_item_ideas" ADD COLUMN "field_values" jsonb DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "curation_item_ideas" ADD COLUMN "asset_id" uuid REFERENCES "assets"("id");
