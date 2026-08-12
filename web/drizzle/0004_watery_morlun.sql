CREATE TABLE "upload_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"publisher_id" uuid,
	"roblox_asset_id" text,
	"roblox_item_url" text NOT NULL,
	"upload_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_records" ADD CONSTRAINT "upload_records_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_records" ADD CONSTRAINT "upload_records_publisher_id_personnel_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."personnel"("id") ON DELETE no action ON UPDATE no action;