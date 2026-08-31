CREATE TABLE "artifact_type_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prefix" text NOT NULL UNIQUE,
	"label" text NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" DROP COLUMN "artifact_type";
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ALTER COLUMN "file_url" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN "artifact_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD CONSTRAINT "knowledge_artifacts_artifact_id_unique" UNIQUE ("artifact_id");
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN "artifact_type_id" uuid NOT NULL REFERENCES "artifact_type_config"("id");
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN "source" text;
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN "tags" text[] DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN "added_by" uuid REFERENCES "personnel"("id");
--> statement-breakpoint
ALTER TABLE "knowledge_artifacts" ADD COLUMN "usage_notes" text;
