CREATE TABLE "style_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL UNIQUE,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_style_system_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"style_system_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_style_system_links_artifact_id_style_system_id_unique" UNIQUE("artifact_id","style_system_id")
);
--> statement-breakpoint
CREATE TABLE "artifact_campaign_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"campaign_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_campaign_links_artifact_id_campaign_name_unique" UNIQUE("artifact_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "artifact_assignment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_assignment_links_artifact_id_assignment_id_unique" UNIQUE("artifact_id","assignment_id")
);
--> statement-breakpoint
ALTER TABLE "artifact_style_system_links" ADD CONSTRAINT "artifact_style_system_links_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "artifact_style_system_links" ADD CONSTRAINT "artifact_style_system_links_style_system_id_style_systems_id_fk" FOREIGN KEY ("style_system_id") REFERENCES "public"."style_systems"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "artifact_campaign_links" ADD CONSTRAINT "artifact_campaign_links_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "artifact_assignment_links" ADD CONSTRAINT "artifact_assignment_links_artifact_id_knowledge_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "artifact_assignment_links" ADD CONSTRAINT "artifact_assignment_links_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;
