CREATE TABLE "discord_temp_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"grantee_type" text NOT NULL,
	"grantee_id" text NOT NULL,
	"grantee_name" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"granted_by" text,
	"prior_overwrite" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personnel" ADD COLUMN "discord_user_id" text;