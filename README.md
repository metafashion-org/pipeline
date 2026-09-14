# MetaFashion Pipeline

Internal production-management tool for MetaFashion, a Roblox UGC fashion studio. It tracks a
catalog item ("asset") from idea to paid, published product: curation intake → artist assignment
→ production → review/approval → Roblox publishing → payment — plus the Discord-based team
management, onboarding, forms, marketing and knowledge-base tooling built around that pipeline.

This repo is a rewrite/successor to an earlier internal tool called **Catalog Intel**; several
services (Discord integration especially) are deliberate ports of that tool's logic rather than
fresh implementations — see the "ported from Catalog Intel" comments in `lib/discord/`.

## Repo layout

```
.
├── web/            Next.js app — everything lives here
├── .github/        CI workflows (build/typecheck/deadcode/tests)
├── .githooks/      pre-commit hook (see below)
└── .mcp.json       Supabase MCP server config for Claude Code
```

Only `web/` runs. The root is just repo plumbing.

## Stack (`web/`)

- **Framework**: Next.js 16 (App Router, Turbopack), React 19
- **Database**: Postgres via `postgres`/`drizzle-orm`, migrated with `drizzle-kit` (Supabase-hosted
  in production — see `.mcp.json`)
- **Auth**: NextAuth with Google OAuth as the only provider. Sign-in only gets you a session;
  actual authorization is looked up from the `personnel` table (see below), not from OAuth alone
- **UI**: shadcn/ui (Radix + `@base-ui/react`) + Tailwind CSS v4, `@dnd-kit` for the Kanban board
- **Email**: queued outbound mail (`email_queue`/`email_log` tables + `lib/email/queue-worker.ts`)
- **Data fetching**: SWR on the client
- **Validation**: Zod (`lib/env.ts` validates env vars at startup, fails fast if misconfigured)
- **Testing**: `tsx --test` for unit/integration tests (against a real local Postgres, not mocks),
  Playwright for e2e
- **Dead-code / type gates**: `knip`, `tsc --noEmit`, both run in CI

## Core domain model

Everything revolves around **assets** (`assets` table) — one row per catalog item/SKU. An asset
carries a `currentStatus` string, a `currentArtistId`, fee/currency, reference images (as
`FileStore` JSON pointers, not blobs), and Roblox/marketing metadata. Two tables make the pipeline
auditable and configurable rather than hardcoded:

- **`statuses`** — the ordered list of pipeline stages (label, sort order, which roles may move a
  card into it). This is what the Kanban board's columns are generated from — the pipeline is
  data, not a hardcoded enum.
- **`status_transition_rules`** — which `fromStatus → toStatus` transitions are legal, per role,
  and whether the transition is automatic. `status_history` then logs every actual transition
  (who, when, from/to) for the audit trail and analytics.

**`personnel`** is the single source of truth for who can do what: multi-valued `roles` array,
a `status` (`Active` / `Inactive` / `Blacklisted` — anything but `Active` is denied everywhere,
both pages and API routes), per-person `capabilityOverrides` (JSON booleans layered on top of role
defaults), and Discord linkage fields (`discordUserId`, `discordChannelId`).

### Roles & capabilities (`lib/auth/rbac.ts`)

Seven roles: `admin`, `operator`, `curator`, `artist`, `publisher`, `marketing`, `payment_admin`
(plus a legacy `uploader` alias that maps onto `publisher`). Roles don't gate routes directly —
they resolve to a `CapabilitySet` (`canAssignArtists`, `canApprove`, `canPublishToRoblox`,
`canMarkForPayment`, `canManageSystemConfig`, etc.), which is what routes and UI actually check.
Per-person `capabilityOverrides` can grant or revoke individual capabilities on top of role
defaults. `getAuthedUser()` (`lib/auth/authed-user.ts`) is the one place API routes should
establish the caller — it re-checks `personnel.status === "Active"` on every call so revoking
someone's access takes effect immediately, not just on their next page load.

### Shell pages (`app/(shell)/`), by who lands where

| Route | Who | Purpose |
|---|---|---|
| `/admin` | admin, operator (+ anyone with `canViewAllAssets`) | Full Kanban board, all assets |
| `/admin/personnel` | `canManageSystemConfig` | Manage personnel, roles, status, Discord onboarding |
| `/admin/personnel/discord` | Discord manager/admin tier | Discord channel/permission/temp-access management |
| `/admin/forms` | `canManageSystemConfig` | Build/edit form definitions & fields |
| `/admin/curation-fields` | `canManageSystemConfig` | Configure curation intake fields per category |
| `/admin/knowledge` | `canManageKnowledge` (admin/operator/curator) | Knowledge registry: guidelines, style systems, artifacts, links |
| `/admin/marketing` | `canAccessMarketingTools` | Marketing Kanban + update log |
| `/admin/settings` | `canManageSystemConfig` | System settings |
| `/admin/archive` | admin/operator | Archived/completed assets |
| `/admin/board` | admin/operator | (see admin board) |
| `/artist` | artist, or `canMoveToInProduction` | Own assigned assets only |
| `/curator` | curator, or `canAccessCuratorTools` | Idea intake / curation drafts |
| `/publisher` | publisher/uploader, or `canPublishToRoblox` | Shared "ready for upload" queue → record Roblox catalog links |
| `/apply` | public | Public onboarding/access-request form |
| `/forms/[formKey]` | public/authed depending on form | Generic form runtime |
| `/login`, `/unauthorized` | — | Auth entry / access-denied |

`isRouteAllowedForRoles()` / `landingPathForRoles()` in `lib/auth/rbac.ts` drive both the
middleware redirect after login and each page's own guard.

## Feature areas (`lib/`)

- **`kanban/`** — reads the status-driven board (`getKanbanBoardData`), assignment moves
- **`curation/`** — idea intake, per-category configurable fields, draft versions
  (`curation_item_ideas`, `curation_field_config`, `curation_idea_versions`)
- **`assets/`** — SKU generation, Drive-link parsing for reference images, file-store abstraction
- **`deliverables/`** — final deliverable handling, notifying the uploader/publisher queue
- **`publisher/`** — the shared "ready for upload" queue and recording Roblox catalog URLs against
  an asset (`recordRobloxUpload`)
- **`discord/`** — a full Discord REST v10 client (bot-token based) for channel creation/archival,
  permission-bit management, temp access grants, and onboarding a new person into their own
  "Artist: {Name}" channel. Soft-fails (`isConfigured()`) if `DISCORD_BOT_TOKEN`/`DISCORD_GUILD_ID`
  aren't set, rather than throwing
- **`personnel/`** — onboarding-request sync between form submissions and the personnel table
- **`forms/`** — generic form builder/runtime (`form_definitions`/`form_fields`/`form_submissions`),
  used for the public onboarding form and can be reused for other intake forms; includes its own
  rate limiting
- **`payments/`** — payment cycles and per-item payment records (`payment_cycles`,
  `payment_cycle_items`) with an admin-triggered "run" action
- **`knowledge/`** — a registry of reusable artifacts (guidelines, style systems) with typed links
  to SKUs/categories/campaigns/assignments — the internal "wiki" for brand/style rules
- **`marketing/`** — a second, marketing-specific Kanban plus an update log distinct from the
  production pipeline
- **`guidelines/`**, **`archive/`**, **`settings/`**, **`dashboard/`** — supporting services for
  guideline docs, archived-asset views, system settings, and cached dashboard views
- **`email/`** — queued email (assignment notices, etc.) with a worker that drains `email_queue`
- **`cache/`** — Next.js cache-tag helpers for targeted revalidation

## Environment variables

Validated centrally in `web/lib/env.ts` (Zod) — the app refuses to boot if any required var is
missing/invalid. There is no `.env.example` committed; set these in `web/.env.local`:

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | yes | Public base URL |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | yes | NextAuth Google provider |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | yes | NextAuth session/JWT |
| `DATABASE_URL` | yes | Postgres connection string |
| `ADMIN_EMAILS` / `ARTIST_EMAILS` | legacy, optional | Original env-var-only access control from before the `personnel` table existed. Parsed but effectively unused now that authorization comes from `personnel.roles`/`status` |
| `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` | optional | Enables Discord integration; features soft-disable without them |
| `DISCORD_CRON_SECRET` | optional | Auth for the temp-access-expiry cron endpoint |
| `CRON_SECRET` | optional | Auth for other scheduled/cron API routes |

## Development

```bash
cd web
pnpm install
pnpm dev
```

```bash
pnpm db:migrate           # apply migrations
pnpm db:seed              # seed statuses
pnpm db:seed:marketing    # seed marketing status config
pnpm db:seed:knowledge    # seed knowledge artifact types
```

> **Merging a PR that adds a file under `web/drizzle/` does not, by itself, apply it anywhere.**
> Vercel deploys the *code* on every push to `main`; nothing currently runs `pnpm db:migrate`
> against the production database as part of that. Run it against production manually right
> after merging any such PR, or the app can end up deployed against a database that's missing
> the table/column it now expects. Worth turning into an automated deploy step.

```bash
pnpm typecheck
pnpm lint
pnpm deadcode        # knip: unused files/deps/binaries (CI gate)
pnpm deadcode:all    # knip: also unused exports (not CI-gated — intentional backlog)
```

### Tests

Unit/integration tests run against a **real local Postgres** (not mocks):

```bash
pnpm test:db:up      # docker compose up a throwaway Postgres (see docker-compose.test.yml)
pnpm db:migrate && pnpm db:seed && pnpm db:seed:marketing && pnpm db:seed:knowledge
pnpm test            # tsx --test over **/__tests__/*.test.ts
pnpm test:db:down    # tear down
```

`scripts/assert-local-db.mjs` refuses to run against anything but a localhost `DATABASE_URL`, so
this can never accidentally point at the live database. `pnpm test:e2e` runs Playwright.

### Git hooks

`pnpm prepare` (runs on install) points git at `.githooks/` — see `.githooks/pre-commit`.

## CI (`.github/workflows/build.yml`)

Four parallel jobs on push/PR to `main`/`master`: `build`, `deadcode` (knip), `typecheck`
(`tsc --noEmit`), and `test` (spins up a `postgres:16.6-alpine` service, migrates, seeds, runs the
`tsx --test` suite). `react-doctor.yml` runs `react-doctor` separately.

## Integrations / ecosystem

- **Google OAuth** — the only sign-in method (NextAuth)
- **Postgres/Supabase** — primary datastore; `.mcp.json` wires the Supabase MCP server into
  Claude Code for this project (docs/account/database/debugging/development/functions/branching
  features)
- **Discord** — bot-driven team channel/role/temp-access management, ported from Catalog Intel
- **Roblox** — assets are published to the Roblox catalog; the publisher flow records the
  resulting catalog item URLs against the asset rather than integrating with a Roblox API directly
