-- Category scoping for the curation field list, plus the first indexes this schema has ever had.
--
-- Written idempotently on purpose. The live database has been maintained with `drizzle-kit
-- push` since 2026-08-10 (drizzle.__drizzle_migrations stops at 15 entries while migrations
-- 0019-0024 exist on disk and their tables exist in production), so this file has to be safe
-- to apply to a database that already has some of it, as well as to a fresh one built by
-- `pnpm db:migrate`.

-- Nullable, no default, no backfill: an existing row with NULL means "every category", which
-- is exactly what every row means today. Adding it this way is the rolling-deploy-safe order —
-- the column exists and reads as "unscoped" before any code writes to it.
ALTER TABLE "curation_field_config" ADD COLUMN IF NOT EXISTS "applies_to_categories" text[];

--> statement-breakpoint

-- A field key is unique within its form, not across every form. Guarded because the constraint
-- may already exist, and skipped with a notice if current data would violate it rather than
-- failing the whole migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'form_fields_definition_key_unique'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM "form_fields"
      GROUP BY "form_definition_id", "field_key"
      HAVING count(*) > 1
    ) THEN
      RAISE NOTICE 'form_fields has duplicate (form_definition_id, field_key) rows; resolve them, then add form_fields_definition_key_unique by hand.';
    ELSE
      ALTER TABLE "form_fields"
        ADD CONSTRAINT "form_fields_definition_key_unique" UNIQUE ("form_definition_id", "field_key");
    END IF;
  END IF;
END $$;

--> statement-breakpoint

-- Board queries: assets are grouped by status on every board render, and filtered by assignee
-- on every artist board render. Both were sequential scans.
CREATE INDEX IF NOT EXISTS "assets_current_status_idx" ON "assets" ("current_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_current_artist_idx" ON "assets" ("current_artist_id");--> statement-breakpoint

-- The asset drawer reads one asset's transitions newest-first every time it opens.
CREATE INDEX IF NOT EXISTS "status_history_asset_created_idx" ON "status_history" ("asset_id", "created_at");--> statement-breakpoint

-- getBriefFieldsForAsset finds an idea by the asset it created, on every assignment email.
CREATE INDEX IF NOT EXISTS "curation_item_ideas_asset_idx" ON "curation_item_ideas" ("asset_id");--> statement-breakpoint
-- listActiveDrafts filters a curator's own drafts by status.
CREATE INDEX IF NOT EXISTS "curation_item_ideas_submitter_status_idx" ON "curation_item_ideas" ("submitted_by", "status");--> statement-breakpoint

-- Form rendering and the review queue.
CREATE INDEX IF NOT EXISTS "form_fields_definition_sort_idx" ON "form_fields" ("form_definition_id", "sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submissions_form_status_idx" ON "form_submissions" ("form_definition_id", "status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "curation_field_config_active_sort_idx" ON "curation_field_config" ("is_active", "sort_order");--> statement-breakpoint

-- GIN over the two JSONB columns that hold answers people typed, so a query can ask which rows
-- carry a given key or value instead of reading every row and unpacking it in application code.
-- The other JSONB columns in this schema (form_fields.options, form_fields.validation_rules,
-- personnel.capability_overrides, assets.reference_images) are always read whole by primary key,
-- so a GIN index there would cost write throughput and buy nothing.
CREATE INDEX IF NOT EXISTS "curation_item_ideas_field_values_gin" ON "curation_item_ideas" USING gin ("field_values");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submissions_values_gin" ON "form_submissions" USING gin ("values");
-- Note on budget / deadline: they were duplicated, existing both as typed columns on `assets`
-- and as curation_field_config rows that rendered a second input writing strings into
-- field_values. That is fixed in code, not here — the config rows stay (they own the label,
-- ordering and whether the field reaches the artist brief) and the curation form simply stops
-- rendering an input for anything ASSET_FIELD_ACCESSORS can read off the asset. No data change.
