# Working with the database

Postgres 16, accessed through Drizzle ORM (`drizzle-orm` with the `postgres` driver). Table definitions are in `web/lib/db/schema/`, migrations are in `web/drizzle/`, and the tables and their links are described in `guides/erd.md`.

## Databases

| Database | Where | Connection |
|---|---|---|
| Production | Supabase project `cnwxoggeziqfpyulqtdr` | `DATABASE_URL` in `web/.env.local`, and the Supabase MCP server in `.mcp.json` |
| Local test | Docker container `metafashion-test` from `web/docker-compose.test.yml` | `postgresql://postgres:postgres@localhost:5433/metafashion_test` |
| CI | `postgres:16.6-alpine` service in `.github/workflows/build.yml` | same URL as local test |

Agents read from production only when the task needs live data, and never write to it unless the user asks for that write in the current conversation. That covers `pnpm db:migrate`, every `db:seed*` script, `pnpm db:push`, `lib/db/run-migrations.ts`, and SQL run through the Supabase MCP server.

The spreadsheet `Meta Fashion Digital Assets Pipeline.xlsx` at the repo root is untracked, and the team still edits it alongside the database. An import from it inserts rows that are missing and updates rows that are newer in the sheet. It never overwrites or deletes a database row wholesale.

## Local test database

Run from `web/`:

```bash
pnpm test:db:up
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/metafashion_test
pnpm test
pnpm test:db:down
```

`pnpm test:db:up` runs `scripts/test-db.sh`. The script starts the container, waits for its healthcheck, then runs `db:migrate`, `db:seed`, `db:seed:marketing`, `db:seed:knowledge` and `db:seed:e2e`. Set `METAFASHION_TEST_DB_PORT` to use a port other than 5433.

Safety guards and their gaps:

- `scripts/test-db.sh` calls `scripts/assert-local-db.mjs`, which exits unless the `DATABASE_URL` host is `localhost` or `127.0.0.1`.
- `playwright.config.ts` refuses to start unless its database host is local.
- `pnpm test` (`scripts/run-tests.mjs`) has no guard. `lib/db/client.ts` calls `dotenv.config({ path: ".env.local" })`, so with `DATABASE_URL` unset the tests insert and delete rows in production. Export the local URL first.
- `playwright.config.ts` defaults `E2E_DATABASE_URL` to port 5432, while `test-db.sh` uses 5433. Set `E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/metafashion_test` before `pnpm test:e2e`.

## Reading data

```ts
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";

const rows = await db
  .select({ sku: assets.sku, itemName: assets.itemName, artistName: personnel.name })
  .from(assets)
  .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
  .where(and(eq(assets.currentStatus, "in_review"), inArray(assets.category, categories)))
  .orderBy(desc(assets.updatedAt))
  .limit(PAGE_SIZE);
```

- Import `db` from `@/lib/db/client`. It is the one shared connection pool, with a maximum of 10 connections.
- Import each table from its own file, `@/lib/db/schema/<table>`, as most of the codebase does.
- Select the columns you need instead of `db.select()` with no argument when the result goes to a client component.
- Aggregates and expressions the builder can't write use the `sql` template: `` sql`count(*)::int` ``. Values placed in `${}` are sent as parameters. `lib/dashboard/dashboard-service.ts` has examples.
- Put queries in a service file under `web/lib/<area>/`. A page loader that every admin reads the same way is wrapped in `cachedView()` from `lib/cache/tags.ts`.

## Writing data

- Change asset status with `updateAssetStatusInKanban(sku, statusKey, actor, note)` from `lib/kanban/kanban-service.ts`. It rejects unknown status keys, blocks artists from moving assets not assigned to them, and applies `status_transition_rules` with deny by default. Refusals throw `TransitionRefusedError` (`lib/kanban/transition-errors.ts`). It carries a `code`, a plain-language `title`, `reason` and `hint`, and the `httpStatus` a route answers with: 403 for a permission refusal, 404 or 400 for a stale asset or status. Admins may make a move that has no rule, except into `marked_for_payment` or `payment_done`.
- A write that changes more than one table goes inside `db.transaction(async (tx) => { ... })`, with every statement using `tx`. The codebase has no transactions today.
- An admin change to personnel, assets or configuration inserts an `audit_log` row: `{ action, entityType, entityId, actorId, payload }`.
- After changing `personnel.roles` or `personnel.status`, call `invalidatePersonnelAuthCache(email)` from `lib/auth/personnel-auth.ts`. Without it the old roles stay in effect for up to 60 seconds.
- After a write that affects a cached view, call `revalidateViews(CACHE_TAGS.<tag>)`. The tags are `publisherQueue`, `knowledge`, `marketing`, `curationFields`, `forms`, `personnel` and `onboardingRequests`. A missed call leaves the view stale for up to 300 seconds.
- Pass `numeric` columns as strings (`feeAmount: "100.00"`).
- Retire configuration rows by setting `is_active = false` instead of deleting them. Old `curation_item_ideas.field_values` entries stay readable that way.

## Migrations

`drizzle-kit` can't generate migrations for this repo. Its snapshots in `web/drizzle/meta/` stop at `0018`, while migrations `0019` to `0028` were written by hand. The live database was also changed with `drizzle-kit push` at times, so every migration must run cleanly on a database that already has some or all of its changes.

To change the schema:

1. Edit or add the table file in `web/lib/db/schema/`. For a new table, add `export * from "./<table>";` to `schema/index.ts`.
2. Write `web/drizzle/00NN_<short_name>.sql`, where `NN` is the next number after the last file. Make every statement idempotent, following `0028_brand_groups.sql`:
   - `CREATE TABLE IF NOT EXISTS`
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - constraints and foreign keys inside a `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...') THEN ... END IF; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;` block
3. Start the file with a SQL comment saying what the migration adds.
4. Append an entry to `web/drizzle/meta/_journal.json` with `idx` one higher than the last entry, `"version": "7"`, `tag` equal to the file name without `.sql`, and `"breakpoints": true`. Set `when` to the current time in milliseconds. The Drizzle migrator skips any migration whose `when` is not greater than that of the last migration it applied, which is `1789482000000` for `0028`.
5. Apply it locally twice, and confirm the second run also succeeds:
   ```bash
   export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/metafashion_test
   pnpm db:migrate && pnpm db:migrate
   ```
6. Run `pnpm typecheck` and the tests for the affected area.
7. Say in the PR description that it adds a migration. Merging deploys the code to Vercel but doesn't migrate production. Someone runs `pnpm db:migrate` against production right after the merge.

Don't run `pnpm db:generate`, which diffs the schema against the `0018` snapshot and writes a migration repeating the changes from `0019` to `0028`. Don't run `pnpm db:push`, which alters the target database directly and leaves no migration file. Apply migrations with `pnpm db:migrate` (`lib/db/run-migrate.ts`).

## Seeds

| Script | Writes | Source |
|---|---|---|
| `pnpm db:seed` | 11 pipeline statuses and their transition rules | `lib/db/seed-statuses.ts` |
| `pnpm db:seed:marketing` | 9 marketing statuses | `lib/marketing/marketing-service.ts` |
| `pnpm db:seed:knowledge` | artifact types and prefixes | `lib/knowledge/seed-artifact-types.ts` |
| `pnpm db:seed:e2e` | fixtures for Playwright | `lib/db/seed-e2e-fixtures.ts` |

Seeds check for existing rows before inserting, so running one twice doesn't duplicate data.

## Inspecting production

- `GET /api/health/db` returns `{ ok: true }` when the app can reach the database.
- The Supabase MCP server can list tables and run read-only SQL. Show the user the exact SQL before running anything that writes.
