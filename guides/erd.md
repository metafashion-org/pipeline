# Entity relationship diagram

The database has 34 tables and one enum (`personnel_status`: `Active`, `Blacklisted`, `Inactive`). Each table is defined in `web/lib/db/schema/<table>.ts`, which is the source for everything below. Every primary key is a `uuid` named `id` with a random default, and every timestamp is `timestamp with time zone`.

The diagrams show primary keys, foreign keys and the columns other tables depend on. Solid lines are foreign key constraints. Dotted lines are joins on a text value with no constraint, and the database won't stop those values from going stale.

## Production pipeline

An asset is one catalog item, identified by `sku`. Its stage is `assets.current_status`, which holds a `statuses.key`.

```mermaid
erDiagram
  personnel {
    uuid id PK
    text email UK
    text_array roles
    personnel_status status
    jsonb capability_overrides
    text discord_user_id
  }
  brand_groups {
    uuid id PK
    text name UK
  }
  statuses {
    uuid id PK
    text key UK
    int sort_order
    text_array who_can_move_in
  }
  status_transition_rules {
    uuid id PK
    text from_status
    text to_status
    text role
    bool is_allowed
    bool is_automatic
  }
  assets {
    uuid id PK
    text sku UK
    text current_status
    uuid current_artist_id FK
    uuid brand_group_id FK
    text category
    numeric fee_amount
    text currency
    text marketing_status
  }
  assignments {
    uuid id PK
    uuid asset_id FK
    uuid artist_id FK
    uuid assigned_by FK
    bool is_active
  }
  assignment_ccs {
    uuid id PK
    uuid assignment_id FK
    uuid personnel_id FK
  }
  status_history {
    uuid id PK
    uuid asset_id FK
    text from_status
    text to_status
    uuid actor_id FK
  }
  upload_records {
    uuid id PK
    uuid asset_id FK
    uuid publisher_id FK
    text roblox_item_url
  }
  payment_cycles {
    uuid id PK
    date cycle_date UK
  }
  payment_cycle_items {
    uuid id PK
    uuid cycle_id FK
    uuid asset_id FK
    text sku
    numeric fee_amount
  }
  email_queue {
    uuid id PK
    uuid asset_id FK
    text status
    int attempt_count
  }
  email_log {
    uuid id PK
    uuid queue_id FK
    uuid asset_id FK
    text status
  }
  marketing_status_config {
    uuid id PK
    text status_key UK
  }
  marketing_updates {
    uuid id PK
    uuid asset_id FK
    text marketing_status
    uuid responsible_person_id FK
  }
  audit_log {
    uuid id PK
    text action
    text entity_type
    text entity_id
    uuid actor_id FK
  }

  personnel |o--o{ assets : "current_artist_id"
  brand_groups |o--o{ assets : "brand_group_id"
  statuses ||..o{ assets : "key = current_status"
  statuses ||..o{ status_transition_rules : "key = from_status, to_status"
  assets ||--o{ assignments : "asset_id (cascade)"
  personnel ||--o{ assignments : "artist_id"
  assignments ||--o{ assignment_ccs : "assignment_id (cascade)"
  assets ||--o{ status_history : "asset_id (cascade)"
  personnel |o--o{ status_history : "actor_id"
  assets ||--o{ upload_records : "asset_id (cascade)"
  personnel |o--o{ upload_records : "publisher_id"
  payment_cycles ||--o{ payment_cycle_items : "cycle_id (cascade)"
  assets ||--o{ payment_cycle_items : "asset_id"
  assets |o--o{ email_queue : "asset_id (cascade)"
  email_queue |o--o{ email_log : "queue_id (set null)"
  assets |o--o{ email_log : "asset_id (cascade)"
  assets ||--o{ marketing_updates : "asset_id (cascade)"
  personnel |o--o{ marketing_updates : "responsible_person_id"
  marketing_status_config ||..o{ marketing_updates : "status_key = marketing_status"
  personnel |o--o{ audit_log : "actor_id"
```

Pipeline status keys, in `sort_order`, as seeded by `lib/db/seed-statuses.ts`: `unassigned`, `assigned`, `in_progress`, `in_review`, `revisions_requested`, `approved`, `final_files_received`, `ready_for_upload`, `uploaded_to_roblox`, `marked_for_payment`, `payment_done`.

Marketing status keys, as seeded by `lib/marketing/marketing-service.ts`: `not_planned`, `planned`, `creative_needed`, `scheduled`, `posted`, `boosted_promoted`, `performance_reviewed`, `needs_repost`, `done`.

## Curation, forms and onboarding

A curator drafts an idea in `curation_item_ideas`. Submitting it creates an asset and sets `curation_item_ideas.asset_id`. Forms are admin-built, and the public artist access form feeds `onboarding_requests`.

```mermaid
erDiagram
  personnel {
    uuid id PK
  }
  assets {
    uuid id PK
    text category
  }
  curation_field_config {
    uuid id PK
    text field_key UK
    text field_type
    text_array applies_to_categories
    bool is_active
  }
  curation_item_ideas {
    uuid id PK
    uuid asset_id FK
    uuid submitted_by FK
    text status
    int version
    jsonb field_values
  }
  curation_idea_versions {
    uuid id PK
    uuid idea_id FK
    int version
    jsonb field_values
  }
  form_definitions {
    uuid id PK
    text key UK
    text audience
    text on_submission_behavior
    uuid created_by FK
  }
  form_fields {
    uuid id PK
    uuid form_definition_id FK
    text field_key
    text section
  }
  form_submissions {
    uuid id PK
    uuid form_definition_id FK
    uuid submitter_id FK
    uuid reviewed_by FK
    jsonb values
    text status
  }
  onboarding_requests {
    uuid id PK
    text source
    text external_id
    text status
    uuid personnel_id FK
    uuid reviewed_by FK
  }
  discord_temp_access {
    uuid id PK
    text channel_id
    text grantee_id
    timestamptz expires_at
  }

  assets |o--o{ curation_item_ideas : "asset_id"
  personnel |o--o{ curation_item_ideas : "submitted_by"
  curation_item_ideas ||--o{ curation_idea_versions : "idea_id (cascade)"
  curation_field_config ||..o{ curation_item_ideas : "field_key = key in field_values"
  personnel |o--o{ form_definitions : "created_by"
  form_definitions ||--o{ form_fields : "form_definition_id (cascade)"
  form_definitions ||--o{ form_submissions : "form_definition_id (cascade)"
  personnel |o--o{ form_submissions : "submitter_id, reviewed_by"
  form_submissions |o..o| onboarding_requests : "id = external_id when source is email"
  personnel |o--o{ onboarding_requests : "personnel_id (set null), reviewed_by"
```

`discord_temp_access` has no relations. It stores Discord channel permission grants with an expiry, read by the cron at `app/api/admin/discord/expire-temp-access/route.ts`.

## Registry (knowledge artifacts)

The UI calls this area "Registry". The code and tables still use `knowledge`. An artifact gets a permanent ID such as `TR001` from its type's prefix and `next_sequence`, and it can be attached to six kinds of target through link tables.

```mermaid
erDiagram
  personnel {
    uuid id PK
  }
  assets {
    uuid id PK
  }
  assignments {
    uuid id PK
  }
  artifact_type_config {
    uuid id PK
    text prefix UK
    int next_sequence
  }
  knowledge_artifacts {
    uuid id PK
    text artifact_id UK
    uuid artifact_type_id FK
    uuid added_by FK
    text_array tags
  }
  guidelines {
    uuid id PK
    text guideline_type
  }
  style_systems {
    uuid id PK
    text name UK
  }
  artifact_sku_links {
    uuid artifact_id FK
    uuid asset_id FK
  }
  artifact_assignment_links {
    uuid artifact_id FK
    uuid assignment_id FK
  }
  artifact_guideline_links {
    uuid artifact_id FK
    uuid guideline_id FK
  }
  artifact_style_system_links {
    uuid artifact_id FK
    uuid style_system_id FK
  }
  artifact_category_links {
    uuid artifact_id FK
    text category
  }
  artifact_campaign_links {
    uuid artifact_id FK
    text campaign_name
  }

  artifact_type_config ||--o{ knowledge_artifacts : "artifact_type_id"
  personnel |o--o{ knowledge_artifacts : "added_by"
  knowledge_artifacts ||--o{ artifact_sku_links : "artifact_id"
  assets ||--o{ artifact_sku_links : "asset_id"
  knowledge_artifacts ||--o{ artifact_assignment_links : "artifact_id"
  assignments ||--o{ artifact_assignment_links : "assignment_id"
  knowledge_artifacts ||--o{ artifact_guideline_links : "artifact_id"
  guidelines ||--o{ artifact_guideline_links : "guideline_id"
  knowledge_artifacts ||--o{ artifact_style_system_links : "artifact_id"
  style_systems ||--o{ artifact_style_system_links : "style_system_id"
  knowledge_artifacts ||--o{ artifact_category_links : "artifact_id"
  knowledge_artifacts ||--o{ artifact_campaign_links : "artifact_id"
```

Each link table has a unique constraint on its pair of columns, so an artifact links to a given target once. None of the link foreign keys cascade, so deleting an artifact, asset or assignment that has links fails until the link rows are deleted.

## Joins without constraints

| Column | Holds | Matches |
|---|---|---|
| `assets.current_status` | status key | `statuses.key` |
| `status_transition_rules.from_status`, `to_status` | status key | `statuses.key` |
| `status_history.from_status`, `to_status` | status key at the time of the move | `statuses.key` |
| `status_transition_rules.role` | role name, or null for automatic moves | `SystemRole` in `lib/auth/rbac.ts` |
| `personnel.roles` | role names | `SystemRole`, plus the alias `uploader` for `publisher` |
| `assets.marketing_status`, `marketing_updates.marketing_status` | marketing status key | `marketing_status_config.status_key` |
| `assets.category`, `artifact_category_links.category`, `curation_field_config.applies_to_categories` | free-text category name | each other |
| `artifact_campaign_links.campaign_name` | free-text campaign name | `marketing_updates.campaign` |
| `curation_item_ideas.field_values` keys | field key | `curation_field_config.field_key` |
| `onboarding_requests.external_id` | `form_submissions.id` when `source` is `email`, a Discord user ID when `source` is `discord` | as stated |
| `audit_log.entity_id` | ID of the row named by `entity_type` | any table |

## Column conventions

- Money is `numeric(10,2)`, and Drizzle returns it as a string such as `"100.00"`. `currency` is a text code with default `INR`.
- `payment_cycle_items` copies `sku`, `fee_amount` and `currency` when a cycle runs, so later edits to an asset don't change a past cycle.
- Lists are Postgres `text[]` arrays. Structured data is `jsonb`.
- `curation_item_ideas.field_values` and `form_submissions.values` have GIN indexes, so they can be searched by key or value in SQL.
- Status-like columns (`form_submissions.status`, `email_queue.status`, `onboarding_requests.source`) are plain text, with the allowed values listed in a comment in the schema file. Only `personnel.status` is a Postgres enum.
- Drizzle `relations()` are not defined, and `db.query` is not used. Every join is written with `.innerJoin` or `.leftJoin`.
